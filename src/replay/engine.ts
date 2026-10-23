// 記録を「シード＋入力ログ」からもう一度計算する共有部品。
// player / highlights / cause の 3 つがこれを使う。
//
// 再現のしかた:
//   - createSimulation(seed) を新しく作り、tick 0 から endTick まで 1 つずつ進める
//   - 入力は「その tick の stepFixed の前」に投入する
//     （元のプレイでも、tick T の射出は T→T+1 のステップ前に受け付けられている。
//       つまり「tick T の盤面」には tick T の入力は出ず、tick < T の入力だけが出る）
//   - 最初（tick 0）と最後（endTick）の盤面を記録の指紋と照合する。
//     記録に含まれない入力が受理された・盤面が記録と違う、のときは
//     「記録と合わない」として失敗を返す（黙って違う絵を出さない）。
//     失敗の detail には、どこがどう違ったかを追えるだけの情報を入れる。
//   - endTick が上限（既定 MAX_REPLAY_TICKS = 1 時間ぶん）を越える記録は
//     「長すぎる」(tooLong) として、計算を始める前に止める。
//     合わせる作業は記録の長さに比例して掛かるので、終わらない盤面で
//     endTick だけを大きく書き換えられた記録を渡されると実質止まらない。

import type { GameEvent, GameSnapshot, Tick } from '../contracts/game';
import { HEAT_STATE_LIMITS, TICK_HZ } from '../game/constants';
import { createSimulation, type SimulationState } from '../game/simulation';
import { rulesVersion, snapshotHash, type ReplayRecord } from './record';

export type ReplayFailure =
  | Readonly<{ ok: false; reason: 'rulesMismatch'; expected: string; actual: string }>
  | Readonly<{ ok: false; reason: 'tooLong'; limit: Tick; endTick: Tick }>
  | Readonly<{ ok: false; reason: 'diverged'; detail: string }>;

/**
 * 1 つの出来事と、それが stepFixed の戻り値として返った時点の tick。
 * at は「そのステップで到達した tick」。launch は撃った直後の stepFixed で
 * 返るため、at が event.tick より 1 大きくなりうる（他の出来事は一致する）。
 */
export type IndexedEvent = Readonly<{ at: Tick; event: GameEvent }>;

export type ReplayCheckpoint = Readonly<{ state: SimulationState; nextInput: number }>;

export type ReplayRun = Readonly<{
  ok: true;
  /** 起きた順の全出来事。at = その出来事が返った tick（= そのステップで到達した tick） */
  events: readonly IndexedEvent[];
  /** tick 0 と checkpointEvery ごとの盤面（GameSnapshot は不変なので、そのまま持ってよい） */
  checkpoints: readonly GameSnapshot[];
  /** checkpoints を取った間隔。0 = 中間の盤面は取っていない */
  checkpointEvery: Tick;
  /** 復元用の状態。JSON 化せずメモリだけに保持する。 */
  states: readonly ReplayCheckpoint[];
  critical: GameSnapshot | null;
  lastHeatRise: GameSnapshot | null;
  final: GameSnapshot;
}>;

/** 盤面を覚えておく間隔の既定値（60 tick = 0.5 秒）。 */
export const CHECKPOINT_EVERY = 60;

/**
 * 検証に使う tick の上限（1 時間ぶん）。
 * 「記録と合うか」の確かめは endTick ぶん全部計算し直すので、記録の長さに
 * 比例して掛かる。上限が無いと、共有された記録の endTick ひとつの書き換えで
 * 何時間もの再計算を始めてしまう（終わらない盤面なら実質永遠）。
 * これを越える記録を確かめたい時は options.maxTicks で上げる。
 */
export const MAX_REPLAY_TICKS: Tick = TICK_HZ * 60 * 60;

export type RunOptions = {
  /**
   * checkpoints を取る間隔（既定 60）。0 で中間の盤面を取らない。
   * 出来事と visit だけ要る用途（見どころ・負けた理由）では 0 を渡し、
   * 長い記録で盤面を溜め込まないようにする。
   */
  checkpointEvery?: Tick;
  /** プレイヤーを作るときだけ復元用の状態も取る。 */
  captureStates?: boolean;
  /** endTick の上限（既定 MAX_REPLAY_TICKS）。越える記録は tooLong を返す。 */
  maxTicks?: Tick;
  /** 各ステップの直後に呼ばれる（per-tick の熱量などが要る題目用）。盤面は変えないこと。 */
  visit?: (snapshot: GameSnapshot, surfaced: readonly GameEvent[]) => void;
};

/**
 * 記録を最初から endTick まで計算し直す。
 * 返り値は「合った」か「合わなかったか（rulesMismatch / tooLong / diverged）」のどちらか。
 */
export function runReplay(record: ReplayRecord, options: RunOptions = {}): ReplayRun | ReplayFailure {
  const expected = rulesVersion();
  if (record.rulesVersion !== expected) {
    return { ok: false, reason: 'rulesMismatch', expected, actual: record.rulesVersion };
  }
  const limit = options.maxTicks ?? MAX_REPLAY_TICKS;
  if (record.endTick > limit) {
    // 「合わない」(diverged) ではなく「長すぎる」: 記録自体は正しい可能性が
    // 残る（本当に長いプレイかもしれない）ので、別の理由にして区別できるようにする。
    return { ok: false, reason: 'tooLong', limit, endTick: record.endTick };
  }

  const every = options.checkpointEvery ?? CHECKPOINT_EVERY;
  const sim = createSimulation(record.seed, record.setup);
  // 開始の盤面（入力を反映する前の tick 0）が記録と違う = seed / setup / 初期キューが
  // 書き換えられた。熱量のように終わる頃には同じ状態へ収束して最終照合を
  // すり抜ける細工も、ここで「合わない」と分かる。
  const initHash = snapshotHash(sim.getSnapshot());
  if (initHash !== record.initialHash) {
    return {
      ok: false,
      reason: 'diverged',
      detail:
        `開始の盤面が記録と合わない（計算: ${initHash} / 記録: ${record.initialHash}）。` +
        'seed・setup・初期キューのどれかが元の開始を再現していない',
    };
  }
  const inputs = record.inputs;
  let nextInput = 0;
  const events: IndexedEvent[] = [];
  const checkpoints: GameSnapshot[] = [];
  const states: ReplayCheckpoint[] = [];
  let critical: GameSnapshot | null = null;
  let lastHeatRise: GameSnapshot | null = null;
  const observe = (snap: GameSnapshot, surfaced: readonly GameEvent[]): void => {
    if (critical === null && snap.heat >= HEAT_STATE_LIMITS[2]) critical = snap;
    if (surfaced.some((e) => e.kind === 'overLimitStart')) lastHeatRise = snap;
    options.visit?.(snap, surfaced);
  };
  const checkpoint = (): void => {
    checkpoints.push(sim.getSnapshot());
    if (options.captureStates) states.push({ state: sim.exportState(), nextInput });
  };

  // いまの tick に届いている入力を順に投入する。
  // 受理されない入力・順序のおかしい入力があれば記録が壊れているので、
  // 原因を追える文を返す（問題なければ null）。
  const applyInputs = (tick: Tick): string | null => {
    while (nextInput < inputs.length && inputs[nextInput]!.tick === tick) {
      const idx = nextInput;
      const input = inputs[idx]!;
      nextInput++;
      const res = sim.submitLaunch(input);
      if (!res.accepted) return `入力 #${idx}（tick ${tick}）が受理されなかった: ${res.reason}`;
    }
    if (nextInput < inputs.length && inputs[nextInput]!.tick < tick) {
      return `入力の順序が壊れている: #${nextInput}（tick ${inputs[nextInput]!.tick}）は既に過ぎた tick ${tick} より前`;
    }
    return null;
  };

  // 最初の盤面は入力を反映する前に取る。
  // 元のプレイでも tick 0 の入力は、tick 0 の盤面が出たあとに撃たれている。
  // （tick 0 の入力は、下のループの最初の周で stepFixed の前に投入される）
  checkpoint();
  observe(sim.getSnapshot(), []);

  while (sim.getSnapshot().tick < record.endTick) {
    const before = sim.getSnapshot();
    if (before.phase === 'over') break; // 記録より先に終わる = 結果が違う
    const bad = applyInputs(before.tick);
    if (bad) return { ok: false, reason: 'diverged', detail: bad };
    const surfaced = sim.stepFixed();
    const after = sim.getSnapshot();
    for (const event of surfaced) events.push({ at: after.tick, event });
    if (every > 0 && after.tick % every === 0) checkpoint();
    observe(after, surfaced);
  }

  // 記録された tick ちょうどに撃たれた入力は、ステップを進めずに反映する
  // （記録の直前に撃って終わった分。盤面には出るがイベントはまだ返っていない）。
  // 注意: この反映は中間の盤面を取った「あと」なので、endTick が
  // checkpointEvery の倍数のとき、checkpoints の終端面（入力反映前）と
  // 下の final（入力反映後）は同じ tick の別物になる。終端の基準は必ず final。
  const badEnd = applyInputs(sim.getSnapshot().tick);
  if (badEnd) return { ok: false, reason: 'diverged', detail: badEnd };

  const final = sim.getSnapshot();
  const diverged = (detail: string): ReplayFailure => ({ ok: false, reason: 'diverged', detail });
  if (nextInput < inputs.length) {
    return diverged(
      `入力が ${inputs.length - nextInput} 件使われなかった` +
        `（先頭の残り: #${nextInput}・tick ${inputs[nextInput]!.tick}、再生は tick ${final.tick} まで）`,
    );
  }
  if (final.tick !== record.endTick) {
    return diverged(`tick ${final.tick}（phase ${final.phase}）までしか進まなかった。記録の endTick は ${record.endTick}`);
  }
  if (final.phase !== record.phase) return diverged(`phase が違う: 計算 ${final.phase} / 記録 ${record.phase}`);
  if (final.score !== record.finalScore) return diverged(`得点が違う: 計算 ${final.score} / 記録 ${record.finalScore}`);
  if (final.bodies.length !== record.finalBodyCount) {
    return diverged(`天体の数が違う: 計算 ${final.bodies.length} / 記録 ${record.finalBodyCount}`);
  }
  // 統計は「どの項目がいくつ違うか」を全部挙げる（1 項目ずつだと、
  // 直したら次が出る、を繰り返すことになる）。
  const statKeys = ['launches', 'merges', 'supernovas', 'maxChain'] as const;
  const statDiff = statKeys
    .filter((k) => final.stats[k] !== record.stats[k])
    .map((k) => `${k}: 計算 ${final.stats[k]} / 記録 ${record.stats[k]}`)
    .join(', ');
  if (statDiff) return diverged(`統計が違う: ${statDiff}`);
  // 最後の全体照合。上の項目をすり抜ける差（熱量・位置・キュー・
  // endTick だけを延ばした改ざんなど）を盤面の指紋で拾う。
  const finalHash = snapshotHash(final);
  if (finalHash !== record.finalHash) {
    return diverged(
      `最終盤面が記録と合わない（計算: ${finalHash} / 記録: ${record.finalHash}）。` +
        '得点・tick・phase・統計は一致するので、差は熱量・天体・キュー・冷却のどれか',
    );
  }

  return { ok: true, events, checkpoints, checkpointEvery: every, states, critical, lastHeatRise, final };
}
