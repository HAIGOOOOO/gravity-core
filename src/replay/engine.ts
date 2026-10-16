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

import type { GameEvent, GameSnapshot, Tick } from '../contracts/game';
import { createSimulation } from '../game/simulation';
import { rulesVersion, snapshotHash, type ReplayRecord } from './record';

export type ReplayFailure =
  | Readonly<{ ok: false; reason: 'rulesMismatch'; expected: string; actual: string }>
  | Readonly<{ ok: false; reason: 'diverged'; detail: string }>;

/** 1 つの出来事と、それが stepFixed の戻り値として返った時点の tick。 */
export type IndexedEvent = Readonly<{ at: Tick; event: GameEvent }>;

export type ReplayRun = Readonly<{
  ok: true;
  /** 起きた順の全出来事。at = その出来事が返った tick（= そのステップで到達した tick） */
  events: readonly IndexedEvent[];
  /** tick 0 と checkpointEvery ごとの盤面（GameSnapshot は不変なので、そのまま持ってよい） */
  checkpoints: readonly GameSnapshot[];
  /** checkpoints を取った間隔。0 = 中間の盤面は取っていない */
  checkpointEvery: Tick;
  final: GameSnapshot;
}>;

/** 盤面を覚えておく間隔の既定値（60 tick = 0.5 秒）。 */
export const CHECKPOINT_EVERY = 60;

export type RunOptions = {
  /**
   * checkpoints を取る間隔（既定 60）。0 で中間の盤面を取らない。
   * 出来事と visit だけ要る用途（見どころ・負けた理由）では 0 を渡し、
   * 長い記録で盤面を溜め込まないようにする。
   */
  checkpointEvery?: Tick;
  /** 各ステップの直後に呼ばれる（per-tick の熱量などが要る題目用）。盤面は変えないこと。 */
  visit?: (snapshot: GameSnapshot, surfaced: readonly GameEvent[]) => void;
};

/**
 * 記録を最初から endTick まで計算し直す。
 * 返り値は「合った」か「合わなかったか（rulesMismatch / diverged）」のどちらか。
 */
export function runReplay(record: ReplayRecord, options: RunOptions = {}): ReplayRun | ReplayFailure {
  const expected = rulesVersion();
  if (record.rulesVersion !== expected) {
    return { ok: false, reason: 'rulesMismatch', expected, actual: record.rulesVersion };
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
      detail: `initial snapshot differs (hash ${initHash} vs record ${record.initialHash}); seed/setup/queue do not reproduce the recorded start`,
    };
  }
  const inputs = record.inputs;
  let nextInput = 0;
  const events: IndexedEvent[] = [];
  const checkpoints: GameSnapshot[] = [];

  // いまの tick に届いている入力を順に投入する。
  // 受理されない入力・順序のおかしい入力があれば記録が壊れているので、
  // 原因を追える文を返す（問題なければ null）。
  const applyInputs = (tick: Tick): string | null => {
    while (nextInput < inputs.length && inputs[nextInput]!.tick === tick) {
      const idx = nextInput;
      const input = inputs[idx]!;
      nextInput++;
      const res = sim.submitLaunch(input);
      if (!res.accepted) return `input #${idx} (tick ${tick}) rejected: ${res.reason}`;
    }
    if (nextInput < inputs.length && inputs[nextInput]!.tick < tick) {
      return `input order broken: input #${nextInput} has tick ${inputs[nextInput]!.tick}, already past tick ${tick}`;
    }
    return null;
  };

  // 最初の盤面は入力を反映する前に取る。
  // 元のプレイでも tick 0 の入力は、tick 0 の盤面が出たあとに撃たれている。
  // （tick 0 の入力は、下のループの最初の周で stepFixed の前に投入される）
  checkpoints.push(sim.getSnapshot());
  options.visit?.(sim.getSnapshot(), []);

  while (sim.getSnapshot().tick < record.endTick) {
    const before = sim.getSnapshot();
    if (before.phase === 'over') break; // 記録より先に終わる = 結果が違う
    const bad = applyInputs(before.tick);
    if (bad) return { ok: false, reason: 'diverged', detail: bad };
    const surfaced = sim.stepFixed();
    const after = sim.getSnapshot();
    for (const event of surfaced) events.push({ at: after.tick, event });
    if (every > 0 && after.tick % every === 0) checkpoints.push(after);
    options.visit?.(after, surfaced);
  }

  // 記録された tick ちょうどに撃たれた入力は、ステップを進めずに反映する
  // （記録の直前に撃って終わった分。盤面には出るがイベントはまだ返っていない）。
  const badEnd = applyInputs(sim.getSnapshot().tick);
  if (badEnd) return { ok: false, reason: 'diverged', detail: badEnd };

  const final = sim.getSnapshot();
  const diverged = (detail: string): ReplayFailure => ({ ok: false, reason: 'diverged', detail });
  if (nextInput < inputs.length) {
    return diverged(
      `${inputs.length - nextInput} inputs were never applied ` +
        `(first leftover: #${nextInput} at tick ${inputs[nextInput]!.tick}, replay reached tick ${final.tick})`,
    );
  }
  if (final.tick !== record.endTick) {
    return diverged(`reached tick ${final.tick} (phase ${final.phase}), expected tick ${record.endTick}`);
  }
  if (final.phase !== record.phase) return diverged(`phase ${final.phase}, expected ${record.phase}`);
  if (final.score !== record.finalScore) return diverged(`score ${final.score}, expected ${record.finalScore}`);
  if (final.bodies.length !== record.finalBodyCount) {
    return diverged(`bodies ${final.bodies.length}, expected ${record.finalBodyCount}`);
  }
  // 統計は「どの項目がいくつ違うか」を全部挙げる（1 項目ずつだと、
  // 直したら次が出る、を繰り返すことになる）。
  const statKeys = ['launches', 'merges', 'supernovas', 'maxChain'] as const;
  const statDiff = statKeys
    .filter((k) => final.stats[k] !== record.stats[k])
    .map((k) => `${k}=${final.stats[k]} vs record ${record.stats[k]}`)
    .join(', ');
  if (statDiff) return diverged(`run stats differ: ${statDiff}`);
  // 最後の全体照合。上の項目をすり抜ける差（熱量・位置・キュー・
  // endTick だけを延ばした改ざんなど）を盤面の指紋で拾う。
  const finalHash = snapshotHash(final);
  if (finalHash !== record.finalHash) {
    return diverged(
      `final snapshot differs (hash ${finalHash} vs record ${record.finalHash}); ` +
        'score/tick/phase/stats match, so the difference is in heat, bodies, queue, or cooldown',
    );
  }

  return { ok: true, events, checkpoints, checkpointEvery: every, final };
}
