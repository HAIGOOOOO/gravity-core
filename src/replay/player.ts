// 記録を再生するプレイヤー。作るときに 1 回全部計算し直し、
// 出来事の索引・一定間隔の盤面・記録との照合を終えてから返す。
//
// seek の速さの設計（詳しい理由は docs/notes/B/swe-replay.md）:
//   シミュレーションの中身は外から複製・復元できない。ある tick の状態を
//   正確に作るには「シードと入力からその tick まで計算し直す」しかない。
//   そこで速さを 3 段に分ける。
//     1. キーフレーム: 計算し直した盤面を一定 tick ごとに覚えておく。
//        その tick への seek と peek（つまみの表示）は一瞬で返る。
//        記録が長いほど取る間隔を広げて、面数が KEYFRAME_CAP を越えないようにする。
//     2. 行った所: seek した先の盤面も覚える（上限つきで古い物から捨てる）。
//        同じ所への再 seek は一瞬。peek もここを引くので、
//        一度止まった tick へつまみを戻すと正確な盤面が出る。
//     3. カーソル: 前にしか進めないシミュレーションを数本持ち、
//        目的地に一番近い（手前にいる）ものを選んで進める。
//        行き来するほどカーソルが散って、戻る距離が短くなる。
//   最悪の場合（後ろへ大きく飛んで、使えるカーソルがない）は
//   tick 0 からの計算し直しになる。これは仕組み上避けられないので、
//   ツマミの途中表示は peek（近いキーフレームを即返す）を使う想定。
//   覚えている物の量は player.memory で計れる。

import type { GameEvent, GameSnapshot, SimulationPort, Tick } from '../contracts/game';
import { TICK_HZ } from '../game/constants';
import { createSimulation } from '../game/simulation';
import { runReplay, type ReplayFailure } from './engine';
import { copySetup, type ReplayRecord } from './record';

/** キーフレーム・キャッシュを取る間隔（60 tick = 0.5 秒）。 */
const KEYFRAME_EVERY = 60;
/**
 * キーフレームの最大数。記録が長いほど取る間隔を広げて、覚える盤面の数を抑える。
 * 間隔を広げないと、2 時間の記録（864,000 tick）で 1 万面を越えてメモリを食う。
 * （盤面からシミュレーションを復元はできないので、広げても seek の計算量は
 *   変わらない。細かく影響するのは peek の粒度だけ）
 */
const KEYFRAME_CAP = 720;

/**
 * キーフレームを取る間隔。短い記録（6 分まで）は KEYFRAME_EVERY。
 * 長い記録は、間隔を広げて盤面の数が cap を越えないようにする。
 * cap は小さく渡せる（テストが短い記録のまま「長い記録の振る舞い」を再現するため）。
 */
export function keyframeInterval(endTick: Tick, cap: number = KEYFRAME_CAP): Tick {
  // cap が 0 以下だと間隔が Infinity になって peek の割り算が壊れるので、1 未満は 1 に丸める
  return Math.max(KEYFRAME_EVERY, Math.ceil(endTick / Math.max(1, cap)));
}

/** 同時に持つシミュレーションの本数。増やすと戻り seek が速くなる代わりにメモリを使う */
const CURSOR_MAX = 4;
/** 「行った所」の記憶の上限（キーフレームとは別枠）。往復し続けても増え続けないようにする */
const VISITED_CAP = 240;

export type ReplayPlayer = {
  /** もとの記録 */
  readonly record: ReplayRecord;
  /** 記録の最後の tick */
  readonly endTick: Tick;
  /** 記録の長さ（秒） */
  readonly durationSeconds: number;
  /** いま表示している tick */
  readonly tick: Tick;
  /** 直前の seek / step で通った区間に起きた出来事（起きた順） */
  readonly events: readonly GameEvent[];
  /**
   * 好きな tick の盤面へ飛ぶ。範囲外は 0〜endTick に収める。
   * キーフレーム・キャッシュに無い tick では、手前にいるカーソルを進める。
   */
  seek(tick: Tick): GameSnapshot;
  /** いまの位置から ticks ぶん進める（戻るときは負）。範囲外は端に収める */
  step(ticks: number): GameSnapshot;
  /**
   * いま表示している盤面。
   * ゲーム画面へそのまま渡せる GameSnapshot。
   */
  snapshot(): GameSnapshot;
  /**
   * seek の速い版。tick にちょうどの記憶面（間隔の倍数・終端・
   * 以前に seek で止まった所）があればそれを、
   * なければ tick 以下で一番近いキーフレームの盤面を即返す。
   * つまみを動かしている途中の表示用。正確な盤面が要るなら seek を使う。
   */
  peek(tick: Tick): GameSnapshot;
  /**
   * 覚えている物の量とおおよその大きさ（計測用）。
   * approxBytes は保持している盤面・出来事・入力を JSON 化したバイト数の合計。
   */
  readonly memory: {
    readonly keyframes: number;
    readonly visited: number;
    /** 動かしているシミュレーションの本数 */
    readonly cursors: number;
    readonly events: number;
    readonly approxBytes: number;
  };
};

export type ReplayStart = Readonly<{ ok: true; player: ReplayPlayer }> | ReplayFailure;

/** 前にしか進めないシミュレーション。入力の次の位置を覚えておく。 */
type Cursor = {
  sim: SimulationPort;
  nextInput: number;
};

export function createReplayPlayer(
  record: ReplayRecord,
  options: { keyframeCap?: number; maxTicks?: Tick } = {},
): ReplayStart {
  // まず全部計算し直して、記録と合うか確かめる。合わなければここで止める。
  // 検証で取る盤面の間隔はそのままキーフレーム間隔にする（長い記録では広がる）。
  const every = keyframeInterval(record.endTick, options.keyframeCap ?? KEYFRAME_CAP);
  const run = runReplay(record, { checkpointEvery: every, maxTicks: options.maxTicks });
  if (!run.ok) return run;
  const { endTick } = record;
  // 呼び出し側があとで記録の中身を書き換えても、カーソルの再計算が腐らないよう
  // 入力と開始状態は作るときに複製して持つ（record.ts と同じ考え方）。
  const inputs = record.inputs.map((i) => ({ ...i }));
  const setup = record.setup === undefined ? undefined : copySetup(record.setup);
  // run の中身は必要な物だけ取り出し、配列ごとの参照をクロージャに残さない
  // （checkpoints の配列自体はキーフレームへ移したあと手放す）。
  const runEvents = run.events;
  const firstSnap = run.checkpoints[0]!;

  // 盤面の記憶は 2 つに分ける。
  //   キーフレーム: 一定間隔の基準面。捨てない（数は endTick / 間隔で決まる）。
  //   行った所:   seek で止まった面。上限を越えたら一番古い物から捨てる。
  //               Map は挿入順を覚えるので、使った物を付け直せば先頭が一番古い。
  const keyframes = new Map<Tick, GameSnapshot>();
  for (const snap of run.checkpoints) keyframes.set(snap.tick, snap);
  keyframes.set(endTick, run.final);
  const visited = new Map<Tick, GameSnapshot>();

  const getVisited = (t: Tick): GameSnapshot | undefined => {
    const s = visited.get(t);
    if (s) {
      visited.delete(t);
      visited.set(t, s);
    }
    return s;
  };
  const putVisited = (t: Tick, s: GameSnapshot): void => {
    visited.delete(t);
    visited.set(t, s);
    if (visited.size > VISITED_CAP) {
      const oldest = visited.keys().next();
      if (!oldest.done) visited.delete(oldest.value);
    }
  };

  const cursors: Cursor[] = [];
  const newCursor = (): Cursor => ({ sim: createSimulation(record.seed, setup), nextInput: 0 });

  /** いまの tick に届いている入力を順に投入する（記録は照合済みなので受理されるはず）。 */
  const applyDue = (c: Cursor): void => {
    const tick = c.sim.getSnapshot().tick;
    while (c.nextInput < inputs.length && inputs[c.nextInput]!.tick === tick) {
      const input = inputs[c.nextInput]!;
      c.nextInput++;
      c.sim.submitLaunch(input);
    }
  };

  /**
   * カーソルを target まで進める。途中の盤面はここでは覚えない:
   * キーフレーム間隔の倍数の盤面は、検証の再計算ですべて keyframes に
   * 入っている（同じ間隔で同じ計算をした結果なので、重ねて取る意味がない）。
   * 終端の盤面も書かない。keyframes[endTick] は「endTick の入力も反映した」
   * 検証済みの盤面で初期化済みなので、入力反映前の面を書くと
   * seek(endTick) が記録と違う盤面を返してしまう。
   * target ちょうどの入力はここでは投入しない: 「tick T の盤面」は
   * tick T の入力が撃たれる前に取られる物なので、反映すると本物より先に進んだ絵になる。
   * （その入力は次にカーソルを進めるとき、T→T+1 のステップ前に投入される）
   * 盤面の tick はローカルで数えず毎回 snapshot から取る:
   * 終了して進めなくなった sim を回し続けず、実際の tick をキーにするため。
   */
  const advance = (c: Cursor, target: Tick): void => {
    let snap = c.sim.getSnapshot();
    while (snap.tick < target && snap.phase === 'active') {
      applyDue(c);
      c.sim.stepFixed();
      snap = c.sim.getSnapshot();
    }
    // 終端に止まった時は、終端ちょうどの入力（記録の直前に撃たれた分）も反映する。
    // runReplay が最終盤面で同じ事をするので、ここで揃えないと
    // 同じ endTick の盤面が経路によって違う物になってしまう。
    if (snap.tick === endTick) applyDue(c);
  };

  /** target 以下で一番近い所にいるカーソル。無ければ足すか、一番手前のものを作り直す。 */
  const cursorFor = (target: Tick): Cursor => {
    let best: Cursor | null = null;
    let rearmost: Cursor | null = null;
    for (const c of cursors) {
      const tick = c.sim.getSnapshot().tick;
      if (tick <= target && (!best || tick > best.sim.getSnapshot().tick)) best = c;
      if (!rearmost || tick < rearmost.sim.getSnapshot().tick) rearmost = c;
    }
    if (best) return best;
    if (cursors.length < CURSOR_MAX) {
      const c = newCursor();
      cursors.push(c);
      return c;
    }
    // 全部が target より先にいる。どれを選んでも 0 から作り直しなので、
    // 一番手前（= そこまでの計算が一番少なく、失う物が小さい）を捨てる。
    const c = rearmost!;
    cursors.splice(cursors.indexOf(c), 1);
    const fresh = newCursor();
    cursors.push(fresh);
    return fresh;
  };

  /** (a, b] の区間に返った出来事を起きた順で取る（a > b なら同じ区間をそのまま返す）。 */
  const eventsBetween = (a: Tick, b: Tick): readonly GameEvent[] => {
    if (a === b) return [];
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    // runEvents は at 昇順。長い記録では数万件になるので、
    // 毎回の全走査を避けて二分探索で区間の頭を探す。
    let first = 0;
    let last = runEvents.length;
    while (first < last) {
      const mid = (first + last) >> 1;
      if (runEvents[mid]!.at <= lo) first = mid + 1;
      else last = mid;
    }
    const out: GameEvent[] = [];
    for (let i = first; i < runEvents.length && runEvents[i]!.at <= hi; i++) out.push(runEvents[i]!.event);
    return out;
  };

  let currentTick: Tick = 0;
  // 最初の盤面はキーフレーム経由で取る。
  // endTick が 0 の記録（撃った直後に記録）では keyframes[0] が
  // 「tick 0 の入力も反映した」最終盤面に置き換わっているため、
  // firstSnap（入力反映前）を使うと snapshot()/seek(0) と peek(0) が食い違う。
  let currentSnap: GameSnapshot = keyframes.get(0) ?? firstSnap;
  let currentEvents: readonly GameEvent[] = [];

  // 範囲外は端に、小数は切り捨てに収める。
  // Infinity は端まで飛ぶ。NaN は「飛べない」ので fallback（いまの位置）に留まる:
  // ツマミの計算が 1 回壊れただけで盤面が先頭へ飛ぶ方が嫌なので、動かさない判断にした。
  const clampTick = (target: Tick, fallback: Tick): Tick => {
    if (Number.isNaN(target)) return fallback;
    return Math.max(0, Math.min(endTick, Math.floor(target)));
  };

  const seek = (target: Tick): GameSnapshot => {
    const t = clampTick(target, currentTick);
    if (t === currentTick) {
      currentEvents = [];
      return currentSnap;
    }
    const prev = currentTick;
    let snap = keyframes.get(t) ?? getVisited(t);
    if (!snap) {
      const c = cursorFor(t);
      advance(c, t);
      snap = c.sim.getSnapshot();
      // 検証済みの記録では必ず snap.tick === t に辿り着く。進めなかった異例では
      // 実際に辿り着いた tick をキーにして覚え、表示位置もそこに合わせる。
      // 間隔の倍数の盤面は検証ですべて keyframes に入っているので、ここで
      // 新たに覚えるのは「行った所」だけで足りる（異例で倍数に止まっても、
      // 行った所に入れるだけで害はない）。
      putVisited(snap.tick, snap);
    }
    currentTick = snap.tick;
    currentSnap = snap;
    currentEvents = eventsBetween(prev, snap.tick);
    return snap;
  };

  const peek = (target: Tick): GameSnapshot => {
    // NaN は「飛べない」ので今の盤面そのものを返す（近いキーフレームへ
    // 跳ぶと、壊れた入力 1 回で絵が巻き戻って見える）。
    if (Number.isNaN(target)) return currentSnap;
    const t = clampTick(target, currentTick);
    // ちょうどの記憶面があればそれを返す。終端は間隔の倍数でなくても
    // 必ず keyframes に入っているので、ここで拾えば peek(endTick) が
    // 1 間隔ぶん古い面ではなく記録の最後の盤面そのものを返す。
    // 「行った所」も見る: 一度 seek で止まった tick へつまみを戻した時に、
    // 手前のキーフレームより新しい・その tick ちょうどの盤面が出る。
    const exact = keyframes.get(t) ?? visited.get(t);
    if (exact) return exact;
    // t 以下で一番近いキーフレームを探す。取りこぼしがあればさらに手前へ辿る
    // （通常は最初の 1 発で当たる。検証で全ての倍数の面が入っているため）。
    for (let key = Math.floor(t / every) * every; key >= 0; key -= every) {
      const snap = keyframes.get(key);
      if (snap) return snap;
    }
    return firstSnap;
  };

  return {
    ok: true,
    player: {
      record,
      endTick,
      durationSeconds: endTick / TICK_HZ,
      get tick() {
        return currentTick;
      },
      get events() {
        return currentEvents;
      },
      get memory() {
        // JSON 化した長さを素直に足す。呼ぶたびに畳み直す計測専用の窓口なので、
        // 盤面表示の速さには影響しない。
        let approxBytes = JSON.stringify(inputs).length + JSON.stringify(runEvents).length;
        for (const s of keyframes.values()) approxBytes += JSON.stringify(s).length;
        for (const s of visited.values()) approxBytes += JSON.stringify(s).length;
        for (const c of cursors) approxBytes += JSON.stringify(c.sim.getSnapshot()).length;
        return {
          keyframes: keyframes.size,
          visited: visited.size,
          cursors: cursors.length,
          events: runEvents.length,
          approxBytes,
        };
      },
      seek,
      step: (ticks: number) => seek(currentTick + Math.floor(ticks)),
      snapshot: () => currentSnap,
      peek,
    },
  };
}
