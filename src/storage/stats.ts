// 1 回のプレイの詳しい統計（題目「記録を作り直す」）。
// ランキングの 1 行（RunRecord）は得点順のために残し、こちらは「どう遊んだか」が分かる数字を
// 別のキーに版つきで蓄える。このファイルは出来事の数え上げだけ（保存は history.ts、
// 検査と移し替えは archive.ts、推移は trend.ts）。

import type { GameEvent, GameSnapshot, RunStats, Tick } from '../contracts/game';
import { TICK_HZ, TIER_COUNT } from '../game/constants';

/** 統計アーカイブの版。形を変えるときは 1 つ上げ、archive.ts の移し替えに足す。 */
export const STATS_VERSION = 1;
/** 残すプレイの件数。古い順に捨てる（1 件あたり数百バイトなので、端末の上限 5MB に十分収まる）。 */
export const MAX_STATS_RUNS = 1000;

/** 1 回のプレイの詳しい統計（版 1）。RunRecord と同じ id で結び付く。名前は持たない（改名はランキング側だけで行う）。 */
export type RunDetailV1 = Readonly<{
  id: string;
  /** ISO 8601 */
  playedAt: string;
  seed: number;
  gameVersion: string;
  score: number;
  /** プレイ時間（秒）。最後の盤面の tick から求める */
  seconds: number;
  launches: number;
  /** 撃った天体が初めて何かに触れた回数 */
  lands: number;
  merges: number;
  supernovas: number;
  maxChain: number;
  /** 到達した一番高い Tier */
  bestTier: number;
  /** 山が限界リングを越えていた合計時間（秒） */
  overLimitSeconds: number;
  /** 限界を越え始めた回数 */
  overLimitEntries: number;
  /** 1 投あたりの得点（0 投なら 0） */
  scorePerLaunch: number;
  /** 1 回の合体・超新星で得た一番大きい点 */
  maxSingleScore: number;
  /** 着地で一番強かった衝突の速さ（論理 px/秒） */
  maxImpactSpeed: number;
  /** 合体元の Tier ごとの合体回数（添字 = Tier。超新星は含めない） */
  mergesByTier: readonly number[];
}>;

export type StatsArchive = Readonly<{
  version: typeof STATS_VERSION;
  /** playedAt の古い順に並べる */
  runs: RunDetailV1[];
}>;

/** 統計には含めず、呼び出し側が持っている情報（記録の識別用） */
export type RunDetailMeta = Readonly<{
  id: string;
  /** ISO 8601 */
  playedAt: string;
  gameVersion: string;
}>;

// ───────── 出来事の数え上げ ─────────
// buildRunDetail（列をまとめて処理）と recorder.ts（1 tick ずつ処理）で共有する。
// ここで値を正規形にそろえるので、1 件の壊れた出来事が統計全体を壊すことはない。

/** 数え上げの途中結果（内部用。recorder が保持する）。 */
export type EventFold = {
  launches: number;
  lands: number;
  merges: number;
  supernovas: number;
  /** 出来事から数えた最大連鎖 */
  chainMax: number;
  /** 閉じた限界区間（越え始め〜終わりの tick）。終了時刻との兼ね合いは仕上げでそろえる */
  overLimitIntervals: { from: Tick; to: Tick }[];
  overLimitEntries: number;
  /** 越え始めた tick。終わっていなければその時刻、越えていなければ null */
  overLimitSince: Tick | null;
  maxSingleScore: number;
  maxImpactSpeed: number;
  mergesByTier: number[];
};

export function createEventFold(): EventFold {
  return {
    launches: 0,
    lands: 0,
    merges: 0,
    supernovas: 0,
    chainMax: 0,
    overLimitIntervals: [],
    overLimitEntries: 0,
    overLimitSince: null,
    maxSingleScore: 0,
    maxImpactSpeed: 0,
    mergesByTier: new Array<number>(TIER_COUNT).fill(0),
  };
}

/** 整数として出る項目（連鎖・単発得点）は、壊れた値（無限・非整数）を落としてから数える。 */
const countInt = (value: number | undefined): number | null =>
  value !== undefined && Number.isFinite(value) ? Math.floor(value) : null;

/** 限界区間の計算に使う tick。NaN・無限は区間を作れないので捨て、負は 0 に丸める。 */
const saneTick = (tick: Tick): Tick | null => (Number.isFinite(tick) ? Math.max(0, tick) : null);

/** 実行時に null・プリミティブなどの物体でない要素を落とす（kind が読めない物も同様）。 */
const isEventLike = (value: unknown): boolean =>
  value !== null && typeof value === 'object' && typeof (value as { kind?: unknown }).kind === 'string';

/** 出来事を 1 件数える。並びが多少乱れていても負の値や NaN に崩れない。 */
export function foldEvent(fold: EventFold, event: GameEvent): void {
  // 列に壊れた要素が混ざっていても 1 件で止まらない（未知の種類は switch を素通りして無視される）
  if (!isEventLike(event)) return;
  switch (event.kind) {
    case 'launch':
      fold.launches++;
      break;
    case 'land':
      fold.lands++;
      if (event.impactSpeed !== undefined && Number.isFinite(event.impactSpeed)
        && event.impactSpeed > fold.maxImpactSpeed) {
        fold.maxImpactSpeed = event.impactSpeed;
      }
      break;
    case 'merge':
      fold.merges++;
      // sourceTier が範囲外だと配列の外に NaN を書き込んでしまうので、検査してから数える
      if (event.sourceTier !== undefined && Number.isInteger(event.sourceTier)
        && event.sourceTier >= 0 && event.sourceTier < TIER_COUNT) {
        fold.mergesByTier[event.sourceTier]++;
      }
      break;
    case 'supernova':
      fold.supernovas++;
      break;
    case 'overLimitStart': {
      const tick = saneTick(event.tick);
      // 「越え始めた回数」は越えていない状態から越えた時だけ数える（重複した start は無視）
      if (tick !== null && fold.overLimitSince === null) {
        fold.overLimitSince = tick;
        fold.overLimitEntries++;
      }
      break;
    }
    case 'overLimitEnd': {
      const tick = saneTick(event.tick);
      // 読めない時刻の end は「来なかった」のと同じ扱い: 区間は開いたまま、仕上げで閉じる
      if (tick !== null && fold.overLimitSince !== null) {
        fold.overLimitIntervals.push({ from: fold.overLimitSince, to: tick });
        fold.overLimitSince = null;
      }
      break;
    }
    case 'gameOver':
      break;
  }
  if (event.kind === 'merge' || event.kind === 'supernova') {
    const chain = countInt(event.chain);
    if (chain !== null && chain > fold.chainMax) fold.chainMax = chain;
    const delta = countInt(event.scoreDelta);
    if (delta !== null && delta > fold.maxSingleScore) fold.maxSingleScore = delta;
  }
}

/** 壊れた盤面の値が統計を保存不能（検証落ち）にしないよう、非負の有限値にそろえる。 */
const nonNegative = (value: number | undefined): number =>
  (value !== undefined && Number.isFinite(value) && value > 0 ? value : 0);
const nonNegativeInt = (value: number | undefined): number => Math.floor(nonNegative(value));

/**
 * 限界を越えていた合計 tick を出す。区間はプレイ時間 [0, tick] の内側に切ってから
 * 和集合を取る（出来事の時刻が前後して区間が重なっても、実際に越えていた時間より
 * 多く数えない）。開いたままの区間は最後の盤面の tick まで越えていた扱いにする
 * （gameOver 時は end が来ないため。0 に倒すと区間全体が消えて過小になる）。
 */
function overLimitTotalTicks(fold: EventFold, tick: number): number {
  const raw = fold.overLimitSince !== null
    ? [...fold.overLimitIntervals, { from: fold.overLimitSince, to: tick }]
    : fold.overLimitIntervals;
  const intervals = raw
    .map((iv) => ({ from: Math.max(0, iv.from), to: Math.min(tick, iv.to) }))
    .filter((iv) => iv.to > iv.from)
    .sort((a, b) => a.from - b.from);
  let total = 0;
  let covered = 0; // 和集合の右端。これより左は数え済みなので重ねて足さない
  for (const iv of intervals) {
    if (iv.to <= covered) continue;
    total += iv.to - Math.max(iv.from, covered);
    covered = iv.to;
  }
  return total;
}

/** 数え上げの結果と最後の盤面・識別情報から 1 回分の統計に仕上げる。fold は変えない。 */
export function finishFold(fold: EventFold, snapshot: GameSnapshot, meta: RunDetailMeta): RunDetailV1 {
  // 盤面・識別情報がまるごと欠けた呼び出しでも落ちないよう、ある分だけ読む
  const snap: Partial<GameSnapshot> = snapshot ?? {};
  const info: Partial<RunDetailMeta> = meta ?? {};
  const tick = nonNegative(snap.tick);
  const overLimitTicks = overLimitTotalTicks(fold, tick);
  const score = nonNegativeInt(snap.score);
  const simStats: Partial<RunStats> = snap.stats ?? {};
  // 読めない日付は保存時の検査で 1 回分まるごと捨てられるので、原点に置き換える（順序だけが古い端にずれる）。
  // id は捏造できないので、文字列でなければ空のまま渡して保存時の検査に落としてもらう
  const playedAt = typeof info.playedAt === 'string' && Number.isFinite(Date.parse(info.playedAt))
    ? info.playedAt
    : '1970-01-01T00:00:00.000Z';
  return {
    id: typeof info.id === 'string' ? info.id : '',
    playedAt,
    seed: nonNegativeInt(snap.seed),
    gameVersion: typeof info.gameVersion === 'string' ? info.gameVersion : '',
    score,
    seconds: tick / TICK_HZ,
    launches: fold.launches,
    lands: fold.lands,
    merges: fold.merges,
    supernovas: fold.supernovas,
    // 出来事の連鎖と盤面の集計の大きい方（片方が欠けても正しい値を残す）
    maxChain: Math.max(fold.chainMax, nonNegativeInt(simStats.maxChain ?? 0)),
    bestTier: Math.min(TIER_COUNT - 1, nonNegativeInt(snap.bestTierThisRun)),
    overLimitSeconds: overLimitTicks / TICK_HZ,
    overLimitEntries: fold.overLimitEntries,
    scorePerLaunch: fold.launches > 0 ? score / fold.launches : 0,
    maxSingleScore: fold.maxSingleScore,
    maxImpactSpeed: fold.maxImpactSpeed,
    mergesByTier: [...fold.mergesByTier],
  };
}

/**
 * 出来事の列（プレイ中に起きた全イベント）と最後の盤面から、1 回分の統計を作る。
 * 数は出来事から数える（自動プレイの記録と 1 対 1 で対応する）。盤面からは
 * 得点・到達 Tier・経過 tick・seed・集計済みの連鎖を取る。
 */
export function buildRunDetail(
  events: readonly GameEvent[],
  snapshot: GameSnapshot,
  meta: RunDetailMeta,
): RunDetailV1 {
  const fold = createEventFold();
  // 列そのものが壊れていても 0 件として仕上げる（1 件の壊れた呼び出しで落ちない）
  if (Array.isArray(events)) for (const event of events) foldEvent(fold, event);
  return finishFold(fold, snapshot, meta);
}
