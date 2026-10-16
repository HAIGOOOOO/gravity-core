// 直近の記録から「上達の移り変わり」を出す純粋な計算。
// 直近 window 件の平均・最大と、その前の window 件との差（伸び）を指標ごとに返す。

import type { RunDetailV1 } from './stats';

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
  /** 全部の記録での最大（窓に関係ない「自己ベスト」）。記録が無ければ null */
  allTimeBest: number | null;
}>;

export type RunTrend = Readonly<{
  /** 使った窓の大きさ */
  window: number;
  recentCount: number;
  previousCount: number;
  /** 比較に使った記録の総数 */
  totalCount: number;
  score: MetricTrend;
  /** プレイ時間（秒） */
  seconds: MetricTrend;
  launches: MetricTrend;
  lands: MetricTrend;
  merges: MetricTrend;
  supernovas: MetricTrend;
  maxChain: MetricTrend;
  bestTier: MetricTrend;
  overLimitSeconds: MetricTrend;
  overLimitEntries: MetricTrend;
  scorePerLaunch: MetricTrend;
  maxSingleScore: MetricTrend;
  maxImpactSpeed: MetricTrend;
}>;

function metricTrend(
  recent: readonly number[],
  previous: readonly number[],
  all: readonly number[],
): MetricTrend {
  const averageOf = (xs: readonly number[]): number | null =>
    xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
  const maxOf = (xs: readonly number[]): number | null =>
    xs.length === 0 ? null : xs.reduce((a, b) => (b > a ? b : a));
  const average = averageOf(recent);
  const previousAverage = averageOf(previous);
  return {
    average,
    best: maxOf(recent),
    previousAverage,
    delta: average !== null && previousAverage !== null ? average - previousAverage : null,
    allTimeBest: maxOf(all),
  };
}

/**
 * 直近 window 件とその前の window 件を比べて、上達の移り変わりを出す。
 * runs はどの順で渡してもよい（playedAt で並べ直す）。日時の読めない記録は
 * 並べ替えの位置が決まらないので、比較から外す。
 */
export function summarizeTrend(runs: readonly RunDetailV1[], windowSize = 10): RunTrend {
  const window = Number.isFinite(windowSize) ? Math.max(1, Math.floor(windowSize)) : 10;
  const sorted = runs
    .filter((run) => Number.isFinite(Date.parse(run.playedAt)))
    .sort((a, b) => Date.parse(a.playedAt) - Date.parse(b.playedAt));
  const recent = sorted.slice(-window);
  const previous = sorted.slice(Math.max(0, sorted.length - window * 2), Math.max(0, sorted.length - window));
  const values = (list: readonly RunDetailV1[], pick: (run: RunDetailV1) => number): number[] => list.map(pick);
  const trend = (pick: (run: RunDetailV1) => number): MetricTrend =>
    metricTrend(values(recent, pick), values(previous, pick), values(sorted, pick));
  return {
    window,
    recentCount: recent.length,
    previousCount: previous.length,
    totalCount: sorted.length,
    score: trend((r) => r.score),
    seconds: trend((r) => r.seconds),
    launches: trend((r) => r.launches),
    lands: trend((r) => r.lands),
    merges: trend((r) => r.merges),
    supernovas: trend((r) => r.supernovas),
    maxChain: trend((r) => r.maxChain),
    bestTier: trend((r) => r.bestTier),
    overLimitSeconds: trend((r) => r.overLimitSeconds),
    overLimitEntries: trend((r) => r.overLimitEntries),
    scorePerLaunch: trend((r) => r.scorePerLaunch),
    maxSingleScore: trend((r) => r.maxSingleScore),
    maxImpactSpeed: trend((r) => r.maxImpactSpeed),
  };
}
