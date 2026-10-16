// 記録を再生するプレイヤー。作るときに 1 回全部計算し直し、
// 出来事の索引・一定間隔の盤面・記録との照合を終えてから返す。
//
// seek の速さの設計（詳しい理由は docs/notes/B/swe-replay.md）:
//   シミュレーションの中身は外から複製・復元できない。ある tick の状態を
//   正確に作るには「シードと入力からその tick まで計算し直す」しかない。
//   そこで速さを 3 段に分ける。
//     1. キーフレーム: 計算し直した盤面を一定 tick ごとに覚えておく。
//        その tick への seek と peek（つまみの表示）は一瞬で返る。
//     2. 行った所: seek した先の盤面も覚える（上限つきで古い物から捨てる）。
//        同じ所への再 seek は一瞬。
//     3. カーソル: 前にしか進めないシミュレーションを数本持ち、
//        目的地に一番近い（手前にいる）ものを選んで進める。
//        行き来するほどカーソルが散って、戻る距離が短くなる。
//   最悪の場合（後ろへ大きく飛んで、使えるカーソルがない）は
//   tick 0 からの計算し直しになる。これは仕組み上避けられないので、
//   ツマミの途中表示は peek（近いキーフレームを即返す）を使う想定。

import type { GameEvent, GameSnapshot, SimulationPort, Tick } from '../contracts/game';
import { TICK_HZ } from '../game/constants';
import { createSimulation } from '../game/simulation';
import { runReplay, type ReplayFailure } from './engine';
import type { ReplayRecord } from './record';

/** キーフレーム・キャッシュを取る間隔（60 tick = 0.5 秒）。 */
const KEYFRAME_EVERY = 60;
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
   * seek の速い版。tick 以下の一番近いキーフレームの盤面を即返す。
   * つまみを動かしている途中の表示用。正確な盤面が要るなら seek を使う。
   */
  peek(tick: Tick): GameSnapshot;
};

export type ReplayStart = Readonly<{ ok: true; player: ReplayPlayer }> | ReplayFailure;

/** 前にしか進めないシミュレーション。入力の次の位置を覚えておく。 */
type Cursor = {
  sim: SimulationPort;
  nextInput: number;
};

export function createReplayPlayer(record: ReplayRecord): ReplayStart {
  // まず全部計算し直して、記録と合うか確かめる。合わなければここで止める。
  const run = runReplay(record, { checkpointEvery: KEYFRAME_EVERY });
  if (!run.ok) return run;
  const { endTick } = record;
  const inputs = record.inputs;

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
  const newCursor = (): Cursor => ({ sim: createSimulation(record.seed, record.setup), nextInput: 0 });

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
   * カーソルを target まで進める（途中のキーフレーム間隔の盤面は覚えていく）。
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
      if (snap.tick % KEYFRAME_EVERY === 0) keyframes.set(snap.tick, snap);
    }
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
    return run.events.filter((ie) => ie.at > lo && ie.at <= hi).map((ie) => ie.event);
  };

  let currentTick: Tick = 0;
  let currentSnap: GameSnapshot = run.checkpoints[0]!;
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
      if (snap.tick % KEYFRAME_EVERY === 0) keyframes.set(snap.tick, snap);
      else putVisited(snap.tick, snap);
    }
    currentTick = snap.tick;
    currentSnap = snap;
    currentEvents = eventsBetween(prev, snap.tick);
    return snap;
  };

  const peek = (target: Tick): GameSnapshot => {
    const t = clampTick(target, currentTick);
    const key = Math.floor(t / KEYFRAME_EVERY) * KEYFRAME_EVERY;
    return keyframes.get(key) ?? run.checkpoints[0]!;
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
      seek,
      step: (ticks: number) => seek(currentTick + Math.floor(ticks)),
      snapshot: () => currentSnap,
      peek,
    },
  };
}
