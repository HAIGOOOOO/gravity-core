import { describe, expect, it } from 'vitest';
import { quantile, summarize } from './stats';

describe('quantile', () => {
  it('端と真ん中はそのままの値を返す', () => {
    const sorted = [10, 20, 30, 40, 50];
    expect(quantile(sorted, 0)).toBe(10);
    expect(quantile(sorted, 0.5)).toBe(30);
    expect(quantile(sorted, 1)).toBe(50);
  });

  it('間の位置は線形に補間する（10%・90%）', () => {
    const sorted = [10, 20, 30, 40, 50];
    // pos = 4 * 0.1 = 0.4 → 10 + 0.4 * 10
    expect(quantile(sorted, 0.1)).toBeCloseTo(14, 10);
    // pos = 4 * 0.9 = 3.6 → 40 + 0.6 * 10
    expect(quantile(sorted, 0.9)).toBeCloseTo(46, 10);
  });

  it('偶数個の中央値は真ん中 2 つの平均', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  it('1 個だけならその値、空なら NaN', () => {
    expect(quantile([7], 0.9)).toBe(7);
    expect(quantile([], 0.5)).toBeNaN();
  });
});

describe('summarize', () => {
  it('平均・中央値・10%・90%・最小・最大を返す（入力は並べ替えない）', () => {
    const input = [50, 10, 40, 20, 30];
    const s = summarize(input);
    expect(s).toEqual({ n: 5, mean: 30, median: 30, p10: 14, p90: 46, min: 10, max: 50 });
    expect(input).toEqual([50, 10, 40, 20, 30]);
  });

  it('小数や負の値でも計算できる', () => {
    const s = summarize([-1.5, 0.5]);
    expect(s.mean).toBe(-0.5);
    expect(s.median).toBeCloseTo(-0.5, 10);
    expect(s.min).toBe(-1.5);
  });

  it('1 個だけなら全部その値', () => {
    const s = summarize([3]);
    expect(s).toEqual({ n: 1, mean: 3, median: 3, p10: 3, p90: 3, min: 3, max: 3 });
  });

  it('空なら個数 0 で値は NaN', () => {
    const s = summarize([]);
    expect(s.n).toBe(0);
    expect(s.mean).toBeNaN();
    expect(s.median).toBeNaN();
  });
});
