// 分布の計算。何回も遊んだ結果を「平均・中央値・10%・90%」で見るための純粋な計算だけ。
// ソートして位置を補間する方式にした: 回数が少なくても端が跳ねすぎない。

export type Stats = Readonly<{
  /** データの個数 */
  n: number;
  mean: number;
  median: number;
  /** 10% 点（この値以下が全体の 1 割） */
  p10: number;
  /** 90% 点（この値以下が全体の 9 割） */
  p90: number;
  min: number;
  max: number;
}>;

/**
 * 昇順に並んだ配列の q 分位点（0〜1）。隣り合う値の間は線形に補間する。
 * 空なら NaN を返す（呼び側で「—」と表示する）。
 */
export function quantile(sorted: readonly number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const w = pos - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

/** 値の並びをまとめる。元の配列は並べ替えず、コピーをソートする。 */
export function summarize(values: readonly number[]): Stats {
  const n = values.length;
  if (n === 0) {
    return { n: 0, mean: NaN, median: NaN, p10: NaN, p90: NaN, min: NaN, max: NaN };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, v) => sum + v, 0) / n;
  return {
    n,
    mean,
    median: quantile(sorted, 0.5),
    p10: quantile(sorted, 0.1),
    p90: quantile(sorted, 0.9),
    min: sorted[0]!,
    max: sorted[n - 1]!,
  };
}
