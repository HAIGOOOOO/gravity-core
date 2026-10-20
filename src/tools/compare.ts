// 2 つのまわし結果を「同じシードどうしの差」で比べる。
// 分布どうしを見比べるとシードのばらつきが混ざって差が読みにくいので、
// 同じシードの対を作り、対ごとの差（B − A）の分布を出す。
// 「setup を変えたらどれだけ違うか」「このボットは基準よりどれだけ強いか」に使う。
//
// 注意: 打ち切り（timedOut）の回は秒数が上限値なので、秒数の差は実際より小さく出る。
// 打ち切りが多い条件を比べるときは、表に出る打ち切り数も併せて見ること。

import { RUN_METRICS, type PlayResult, type RunMetric } from './batch';
import { summarize, type Stats } from './stats';

export type RunDiff = Readonly<{
  /** 両側にあったシードの数（差はこの対から出す） */
  paired: number;
  /** A にだけあったシードの数 */
  onlyA: number;
  /** B にだけあったシードの数 */
  onlyB: number;
  /** 対になったシード（昇順）。確認や次の集計用 */
  seeds: readonly number[];
  /** 指標ごとの「B − A」の分布 */
  deltas: Record<RunMetric, Stats>;
}>;

/**
 * A と B をシードで対にして、指標ごとの差（B − A）の分布を返す。
 * 片側にしか無いシードは対から外す。シードが同じ側で重複していたら最初の 1 件を使う。
 */
export function diffRuns(a: readonly PlayResult[], b: readonly PlayResult[]): RunDiff {
  const bySeed = new Map<number, PlayResult>();
  for (const r of b) {
    if (!bySeed.has(r.seed)) bySeed.set(r.seed, r);
  }
  const values = {} as Record<RunMetric, number[]>;
  for (const m of RUN_METRICS) values[m] = [];
  const seen = new Set<number>();
  const seeds: number[] = [];
  for (const ra of a) {
    if (seen.has(ra.seed)) continue;
    seen.add(ra.seed);
    const rb = bySeed.get(ra.seed);
    if (rb === undefined) continue;
    bySeed.delete(ra.seed);
    seeds.push(ra.seed);
    for (const m of RUN_METRICS) values[m].push(rb[m] - ra[m]);
  }
  seeds.sort((x, y) => x - y);
  const deltas = {} as Record<RunMetric, Stats>;
  for (const m of RUN_METRICS) deltas[m] = summarize(values[m]);
  return { paired: seeds.length, onlyA: seen.size - seeds.length, onlyB: bySeed.size, seeds, deltas };
}
