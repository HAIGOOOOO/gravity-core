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
});
