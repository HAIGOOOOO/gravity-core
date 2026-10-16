import { describe, expect, it } from 'vitest';
import { TIER_COUNT } from '../game/constants';
import { summarizeTrend } from './trend';
import type { RunDetailV1 } from './stats';

function detail(id: string, playedAt: string, over: Partial<RunDetailV1> = {}): RunDetailV1 {
  return {
    id,
    playedAt,
    seed: 1,
    gameVersion: '0.1.0',
    score: 100,
    seconds: 60,
    launches: 10,
    lands: 9,
    merges: 5,
    supernovas: 0,
    maxChain: 2,
    bestTier: 3,
    overLimitSeconds: 0,
    overLimitEntries: 0,
    scorePerLaunch: 10,
    maxSingleScore: 220,
    maxImpactSpeed: 600,
    mergesByTier: new Array<number>(TIER_COUNT).fill(0),
    ...over,
  };
}

describe('上達の移り変わり', () => {
  const days = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString();
  it('記録が無ければ全て null', () => {
    const trend = summarizeTrend([], 10);
    expect(trend.totalCount).toBe(0);
    expect(trend.recentCount).toBe(0);
    expect(trend.score.average).toBeNull();
    expect(trend.score.best).toBeNull();
    expect(trend.score.delta).toBeNull();
    expect(trend.score.allTimeBest).toBeNull();
  });
  it('窓より少ないときは、前の窓の比較は null', () => {
    const runs = [detail('a', days(0), { score: 100 }), detail('b', days(1), { score: 300 })];
    const trend = summarizeTrend(runs, 10);
    expect(trend.totalCount).toBe(2);
    expect(trend.recentCount).toBe(2);
    expect(trend.previousCount).toBe(0);
    expect(trend.score.average).toBeCloseTo(200, 10);
    expect(trend.score.best).toBe(300);
    expect(trend.score.previousAverage).toBeNull();
    expect(trend.score.delta).toBeNull();
    expect(trend.score.allTimeBest).toBe(300);
  });
  it('直近 N 件とその前の N 件を比べて伸びを出す', () => {
    const runs = [
      ...Array.from({ length: 10 }, (_, i) => detail(`old-${i}`, days(i), { score: 100, maxChain: 1 })),
      ...Array.from({ length: 10 }, (_, i) => detail(`new-${i}`, days(10 + i), { score: 250, maxChain: 3 })),
    ];
    const trend = summarizeTrend(runs, 10);
    expect(trend.totalCount).toBe(20);
    expect(trend.recentCount).toBe(10);
    expect(trend.previousCount).toBe(10);
    expect(trend.score.average).toBeCloseTo(250, 10);
    expect(trend.score.previousAverage).toBeCloseTo(100, 10);
    expect(trend.score.delta).toBeCloseTo(150, 10);
    expect(trend.score.best).toBe(250);
    expect(trend.score.allTimeBest).toBe(250);
    expect(trend.maxChain.delta).toBeCloseTo(2, 10);
    expect(trend.maxChain.allTimeBest).toBe(3);
  });
  it('窓に満たない分だけ前の窓を使い、入力の順番は問わない', () => {
    const runs = [
      detail('p1', days(0), { score: 10 }),
      detail('p2', days(1), { score: 20 }),
      detail('r1', days(2), { score: 100 }),
      detail('r2', days(3), { score: 200 }),
    ].reverse();
    const trend = summarizeTrend(runs, 2);
    expect(trend.recentCount).toBe(2);
    expect(trend.previousCount).toBe(2);
    expect(trend.score.average).toBeCloseTo(150, 10);
    expect(trend.score.previousAverage).toBeCloseTo(15, 10);
    expect(trend.score.delta).toBeCloseTo(135, 10);
  });
  it('自己ベストは窓の外にある過去の記録も見る', () => {
    // ずっと昔の 1 回だけ突出して良い記録 → 直近の窓の best には出ないが allTimeBest に出る
    const runs = [
      detail('peak', days(0), { score: 900, maxChain: 8 }),
      ...Array.from({ length: 10 }, (_, i) => detail(`mid-${i}`, days(1 + i), { score: 100, maxChain: 2 })),
      ...Array.from({ length: 10 }, (_, i) => detail(`new-${i}`, days(11 + i), { score: 200, maxChain: 3 })),
    ];
    const trend = summarizeTrend(runs, 10);
    expect(trend.totalCount).toBe(21);
    expect(trend.score.best).toBe(200);
    expect(trend.score.allTimeBest).toBe(900);
    expect(trend.maxChain.best).toBe(3);
    expect(trend.maxChain.allTimeBest).toBe(8);
  });
  it('統計の全指標について平均・最大・伸び・自己ベストを出す', () => {
    const runs = [
      detail('old', days(0), { seconds: 100, launches: 20, lands: 18, merges: 4, supernovas: 0, overLimitEntries: 1, maxSingleScore: 100, maxImpactSpeed: 500, scorePerLaunch: 5 }),
      detail('new', days(1), { seconds: 300, launches: 40, lands: 36, merges: 12, supernovas: 1, overLimitEntries: 3, maxSingleScore: 500, maxImpactSpeed: 900, scorePerLaunch: 15 }),
    ];
    const trend = summarizeTrend(runs, 1);
    expect(trend.seconds.average).toBeCloseTo(300, 10);
    expect(trend.seconds.previousAverage).toBeCloseTo(100, 10);
    expect(trend.seconds.delta).toBeCloseTo(200, 10);
    expect(trend.launches.delta).toBeCloseTo(20, 10);
    expect(trend.lands.delta).toBeCloseTo(18, 10);
    expect(trend.merges.delta).toBeCloseTo(8, 10);
    expect(trend.supernovas.allTimeBest).toBe(1);
    expect(trend.overLimitEntries.delta).toBeCloseTo(2, 10);
    expect(trend.maxSingleScore.allTimeBest).toBe(500);
    expect(trend.maxImpactSpeed.best).toBe(900);
    expect(trend.scorePerLaunch.allTimeBest).toBe(15);
    expect(trend.bestTier.allTimeBest).toBe(3);
    expect(trend.overLimitSeconds.average).toBeCloseTo(0, 10);
  });
  it('窓の大きさがおかしくても 1 以上の整数に丸めて計算する', () => {
    const runs = [detail('a', days(0), { score: 100 }), detail('b', days(1), { score: 300 })];
    expect(summarizeTrend(runs, 0).window).toBe(1);
    expect(summarizeTrend(runs, -5).window).toBe(1);
    expect(summarizeTrend(runs, 2.9).window).toBe(2);
    expect(summarizeTrend(runs, NaN).window).toBe(10);
    expect(summarizeTrend(runs, Infinity).window).toBe(10);
    expect(summarizeTrend(runs, 1).previousCount).toBe(1); // 窓 1 でも前の 1 件と比べられる
  });
  it('合体の Tier 内訳の推移も Tier ごとに出す', () => {
    const byTier = (entries: Record<number, number>): number[] => {
      const list = new Array<number>(TIER_COUNT).fill(0);
      for (const [tier, count] of Object.entries(entries)) list[Number(tier)] = count;
      return list;
    };
    const runs = [
      detail('old', days(0), { mergesByTier: byTier({ 0: 5, 1: 1 }) }),
      detail('mid', days(1), { mergesByTier: byTier({ 0: 3 }) }),
      detail('new', days(2), { mergesByTier: byTier({ 0: 8, 3: 2 }) }),
      detail('short', days(3), { mergesByTier: [4] }), // 長さの足りない内訳
    ];
    const trend = summarizeTrend(runs, 2);
    expect(trend.mergesByTier).toHaveLength(TIER_COUNT);
    // 直近 2 件（new, short）の Tier 0: (8 + 4) / 2 = 6
    expect(trend.mergesByTier[0]?.average).toBeCloseTo(6, 10);
    // その前 2 件（old, mid）の Tier 0: (5 + 3) / 2 = 4
    expect(trend.mergesByTier[0]?.previousAverage).toBeCloseTo(4, 10);
    expect(trend.mergesByTier[0]?.delta).toBeCloseTo(2, 10);
    expect(trend.mergesByTier[0]?.allTimeBest).toBe(8);
    expect(trend.mergesByTier[3]?.allTimeBest).toBe(2);
    // 内訳の無い Tier は 0 として数える
    expect(trend.mergesByTier[5]?.average).toBeCloseTo(0, 10);
  });
  it('日時の読めない記録は並べ替えから外す', () => {
    const runs = [
      detail('bad', 'not-a-date', { score: 9999 }),
      detail('a', days(0), { score: 100 }),
      detail('b', days(1), { score: 300 }),
    ];
    const trend = summarizeTrend(runs, 1);
    expect(trend.totalCount).toBe(2);
    expect(trend.score.best).toBe(300);
    expect(trend.score.allTimeBest).toBe(300);
    expect(trend.score.previousAverage).toBeCloseTo(100, 10);
  });
  it('記録の列そのものや中身が壊れていても、読める分だけで計算する', () => {
    const runs = [
      null,
      42,
      'broken',
      { playedAt: 'not-a-date' },
      {},
      detail('a', days(0), { score: 100 }),
      detail('b', days(1), { score: 300 }),
    ] as unknown as RunDetailV1[];
    const trend = summarizeTrend(runs, 1);
    expect(trend.totalCount).toBe(2);
    expect(trend.score.best).toBe(300);
    expect(trend.score.previousAverage).toBeCloseTo(100, 10);
    expect(summarizeTrend(null as unknown as RunDetailV1[], 10).totalCount).toBe(0);
    expect(summarizeTrend({} as unknown as RunDetailV1[], 10).score.average).toBeNull();
  });
  it('指標の値が壊れていても、その指標だけ有限の値で計算し、ほかは全部使う', () => {
    const runs = [
      detail('a', days(0), { score: 100, launches: 10, mergesByTier: [1, 0, 0, 0, 0, 0, 0, 0, 0] }),
      detail('b', days(1), { score: NaN, launches: 40 }), // score だけ壊れた記録
      { ...detail('c', days(2)), mergesByTier: undefined } as unknown as RunDetailV1, // 内訳の無い記録
    ];
    const trend = summarizeTrend(runs, 3);
    expect(trend.totalCount).toBe(3);
    expect(trend.score.average).toBeCloseTo(100, 10); // NaN は平均に入れない（(100 + 100) / 2）
    expect(trend.score.allTimeBest).toBe(100);
    expect(trend.launches.average).toBeCloseTo(20, 10); // launches は 3 件とも有限（(10 + 40 + 10) / 3）
    expect(trend.mergesByTier[0]?.average).toBeCloseTo(1 / 3, 10); // 内訳の無い記録は 0 として数える
  });
});
