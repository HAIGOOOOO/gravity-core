// 1 回のプレイの詳しい統計（題目 2「記録を作り直す」）。
// ランキングの 1 行（RunRecord）は得点順のために残し、こちらは「どう遊んだか」が分かる数字を
// 別のキーに版つきで蓄える。このファイルは純粋な計算だけ（保存は history.ts）。

import type { RunRecord } from '../contracts/app';
import type { GameEvent, GameSnapshot, Tick } from '../contracts/game';
import { TICK_HZ, TIER_COUNT } from '../game/constants';
import { readRecord } from './data';

/** 統計アーカイブの版。形を変えるときは 1 つ上げ、migrateStatsArchive に移し替えを足す。 */
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

export function defaultStatsArchive(): StatsArchive {
  return { version: STATS_VERSION, runs: [] };
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
  let launches = 0;
  let lands = 0;
  let merges = 0;
  let supernovas = 0;
  let chainFromEvents = 0;
  let overLimitTicks = 0;
  let overLimitEntries = 0;
  let overLimitSince: Tick | null = null;
  let maxSingleScore = 0;
  let maxImpactSpeed = 0;
  const mergesByTier = new Array<number>(TIER_COUNT).fill(0);

  for (const event of events) {
    switch (event.kind) {
      case 'launch':
        launches++;
        break;
      case 'land':
        lands++;
        if (event.impactSpeed !== undefined && event.impactSpeed > maxImpactSpeed) {
          maxImpactSpeed = event.impactSpeed;
        }
        break;
      case 'merge':
        merges++;
        if (event.sourceTier !== undefined) mergesByTier[event.sourceTier]++;
        break;
      case 'supernova':
        supernovas++;
        break;
      case 'overLimitStart':
        overLimitEntries++;
        // 重複した start で区間をずらさないよう、開いていないときだけ覚える
        if (overLimitSince === null) overLimitSince = event.tick;
        break;
      case 'overLimitEnd':
        if (overLimitSince !== null) {
          overLimitTicks += event.tick - overLimitSince;
          overLimitSince = null;
        }
        break;
      case 'gameOver':
        break;
    }
    if (event.kind === 'merge' || event.kind === 'supernova') {
      if (event.chain !== undefined && event.chain > chainFromEvents) chainFromEvents = event.chain;
      if (event.scoreDelta !== undefined && event.scoreDelta > maxSingleScore) {
        maxSingleScore = event.scoreDelta;
      }
    }
  }
  // 終了時点でまだ越えていた分は、最後の盤面の tick まで数える（gameOver 時は end が来ない）
  if (overLimitSince !== null) overLimitTicks += Math.max(0, snapshot.tick - overLimitSince);

  const score = snapshot.score;
  return {
    id: meta.id,
    playedAt: meta.playedAt,
    seed: snapshot.seed,
    gameVersion: meta.gameVersion,
    score,
    seconds: snapshot.tick / TICK_HZ,
    launches,
    lands,
    merges,
    supernovas,
    // 出来事の連鎖と盤面の集計の大きい方（片方が欠けても正しい値を残す）
    maxChain: Math.max(chainFromEvents, snapshot.stats.maxChain),
    bestTier: snapshot.bestTierThisRun,
    overLimitSeconds: overLimitTicks / TICK_HZ,
    overLimitEntries,
    scorePerLaunch: launches > 0 ? score / launches : 0,
    maxSingleScore,
    maxImpactSpeed,
    mergesByTier,
  };
}

/** 古い形（得点順の 1 行だけの RunRecord）を版 1 の統計に移す。元の記録に無い項目は 0。 */
export function detailFromRecord(record: RunRecord): RunDetailV1 {
  return {
    id: record.id,
    playedAt: record.playedAt,
    seed: record.seed,
    gameVersion: record.gameVersion,
    score: record.score,
    seconds: record.seconds,
    launches: record.launches,
    lands: 0,
    merges: record.merges,
    supernovas: record.supernovas,
    maxChain: record.maxChain,
    bestTier: record.bestTier,
    overLimitSeconds: 0,
    overLimitEntries: 0,
    scorePerLaunch: record.launches > 0 ? record.score / record.launches : 0,
    maxSingleScore: 0,
    maxImpactSpeed: 0,
    mergesByTier: new Array<number>(TIER_COUNT).fill(0),
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const nonNegativeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const nonNegativeInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** mergesByTier は書き忘れに耐える（無ければ 0 埋め）。あるのに形が違う物は捨てる。 */
function readMergesByTier(value: unknown): number[] | null {
  if (value === undefined) return new Array<number>(TIER_COUNT).fill(0);
  if (!Array.isArray(value) || value.length !== TIER_COUNT || !value.every(nonNegativeInt)) return null;
  return [...value] as number[];
}

/** 壊れた項目を渡さないための検査（data.ts の readRecord と同じ方針）。 */
export function readRunDetail(value: unknown): RunDetailV1 | null {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || !value.id) return null;
  if (typeof value.playedAt !== 'string' || !Number.isFinite(Date.parse(value.playedAt))) return null;
  if (typeof value.gameVersion !== 'string') return null;
  const ints = ['score', 'seed', 'launches', 'lands', 'merges', 'supernovas', 'maxChain', 'bestTier', 'overLimitEntries', 'maxSingleScore'] as const;
  if (ints.some((key) => !nonNegativeInt(value[key]))) return null;
  const reals = ['seconds', 'overLimitSeconds', 'scorePerLaunch', 'maxImpactSpeed'] as const;
  if (reals.some((key) => !nonNegativeNumber(value[key]))) return null;
  if ((value.bestTier as number) >= TIER_COUNT) return null;
  const mergesByTier = readMergesByTier(value.mergesByTier);
  if (mergesByTier === null) return null;
  return {
    id: value.id,
    playedAt: value.playedAt,
    seed: value.seed as number,
    gameVersion: value.gameVersion,
    score: value.score as number,
    seconds: value.seconds as number,
    launches: value.launches as number,
    lands: value.lands as number,
    merges: value.merges as number,
    supernovas: value.supernovas as number,
    maxChain: value.maxChain as number,
    bestTier: value.bestTier as number,
    overLimitSeconds: value.overLimitSeconds as number,
    overLimitEntries: value.overLimitEntries as number,
    scorePerLaunch: value.scorePerLaunch as number,
    maxSingleScore: value.maxSingleScore as number,
    maxImpactSpeed: value.maxImpactSpeed as number,
    mergesByTier,
  };
}

/** RunRecord の形の列を、版 1 の統計に移す（読めない項目は捨てる）。 */
function migrateLegacyRuns(list: readonly unknown[]): RunDetailV1[] {
  const runs: RunDetailV1[] = [];
  for (const item of list) {
    const record = readRecord(item);
    if (record) runs.push(detailFromRecord(record));
  }
  return runs;
}

/** id の重複を除き、playedAt の古い順に並べて件数を制限する。 */
function normalizeRuns(runs: readonly RunDetailV1[]): RunDetailV1[] {
  const seen = new Set<string>();
  const unique = runs.filter((run) => {
    if (seen.has(run.id)) return false;
    seen.add(run.id);
    return true;
  });
  unique.sort((a, b) => Date.parse(a.playedAt) - Date.parse(b.playedAt));
  return unique.slice(-MAX_STATS_RUNS);
}

/**
 * 保存値（JSON.parse 済みの unknown）を版 1 のアーカイブに移す。
 * - `{version:1, runs}` …… いまの形。1 件ずつ検査し、壊れた物だけ捨てる。
 *   runs の中に旧 RunRecord が混ざっていても拾えるだけ拾う。
 * - `records` を持つ物・裸の配列・`{version:0, runs}` …… 旧 RunRecord の列として移す。
 * - それ以外（未来の版・壊れた物）は移せないので捨てて初期値。
 */
export function migrateStatsArchive(value: unknown): StatsArchive {
  let runs: RunDetailV1[] | null = null;
  if (isObject(value) && value.version === STATS_VERSION && Array.isArray(value.runs)) {
    runs = [];
    for (const item of value.runs) {
      const detail = readRunDetail(item);
      if (detail) runs.push(detail);
      else {
        const record = readRecord(item);
        if (record) runs.push(detailFromRecord(record));
      }
    }
  } else {
    const legacyList = Array.isArray(value)
      ? value
      : isObject(value) && Array.isArray(value.records)
        ? value.records
        : isObject(value) && (value.version === undefined || value.version === 0) && Array.isArray(value.runs)
          ? value.runs
          : null;
    if (legacyList !== null) runs = migrateLegacyRuns(legacyList);
    else if (isObject(value) && value.version === STATS_VERSION) runs = [];
  }
  if (runs === null) return defaultStatsArchive();
  return { version: STATS_VERSION, runs: normalizeRuns(runs) };
}

/** 1 つの指標の、直近の窓とその前の窓の比較。件数が足りない所は null。 */
export type MetricTrend = Readonly<{
  /** 直近 window 件の平均 */
  average: number | null;
  /** 直近 window 件の最大 */
  best: number | null;
  /** その前の window 件の平均（無ければ null） */
  previousAverage: number | null;
  /** average - previousAverage（比較できなければ null） */
  delta: number | null;
}>;

export type RunTrend = Readonly<{
  /** 使った窓の大きさ */
  window: number;
  recentCount: number;
  previousCount: number;
  score: MetricTrend;
  scorePerLaunch: MetricTrend;
  maxChain: MetricTrend;
  bestTier: MetricTrend;
  overLimitSeconds: MetricTrend;
}>;

function metricTrend(recent: readonly number[], previous: readonly number[]): MetricTrend {
  const averageOf = (xs: readonly number[]): number | null =>
    xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
  const average = averageOf(recent);
  const previousAverage = averageOf(previous);
  let best: number | null = null;
  for (const v of recent) if (best === null || v > best) best = v;
  return {
    average,
    best,
    previousAverage,
    delta: average !== null && previousAverage !== null ? average - previousAverage : null,
  };
}

/**
 * 直近 window 件とその前の window 件を比べて、上達の移り変わりを出す。
 * runs はどの順で渡してもよい（playedAt で並べ直す）。
 */
export function summarizeTrend(runs: readonly RunDetailV1[], windowSize = 10): RunTrend {
  const window = Number.isFinite(windowSize) ? Math.max(1, Math.floor(windowSize)) : 10;
  const sorted = [...runs].sort((a, b) => Date.parse(a.playedAt) - Date.parse(b.playedAt));
  const recent = sorted.slice(-window);
  const previous = sorted.slice(Math.max(0, sorted.length - window * 2), Math.max(0, sorted.length - window));
  const values = (list: readonly RunDetailV1[], pick: (run: RunDetailV1) => number): number[] => list.map(pick);
  return {
    window,
    recentCount: recent.length,
    previousCount: previous.length,
    score: metricTrend(values(recent, (r) => r.score), values(previous, (r) => r.score)),
    scorePerLaunch: metricTrend(values(recent, (r) => r.scorePerLaunch), values(previous, (r) => r.scorePerLaunch)),
    maxChain: metricTrend(values(recent, (r) => r.maxChain), values(previous, (r) => r.maxChain)),
    bestTier: metricTrend(values(recent, (r) => r.bestTier), values(previous, (r) => r.bestTier)),
    overLimitSeconds: metricTrend(
      values(recent, (r) => r.overLimitSeconds),
      values(previous, (r) => r.overLimitSeconds),
    ),
  };
}
