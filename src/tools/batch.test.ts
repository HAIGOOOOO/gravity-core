import { describe, expect, it } from 'vitest';
import { at } from '../fixtures/index';
import { TICK_HZ } from '../game/constants';
import { playOnce, runBatch, summarizeRuns } from './batch';
import { randomBot } from './bots';

describe('playOnce', () => {
  it('時間の上限で打ち切られ timedOut になる', () => {
    const { result } = playOnce(randomBot(1), { seed: 1, maxTicks: 10 * TICK_HZ });
    expect(result.timedOut).toBe(true);
    expect(result.ticks).toBeGreaterThanOrEqual(10 * TICK_HZ);
    // 断られた分だけ少し超えることがある（やり直しの待ち tick）
    expect(result.ticks).toBeLessThanOrEqual(10 * TICK_HZ + 12);
    expect(result.launches).toBeGreaterThan(0);
  });

  it('熱量が 75 を越えた回数を数える（越えてから終わるまで 1 回）', () => {
    // 限界リングを越える大きい山 + 熱量 70 から始めると、すぐ 75 を越えて 100 で終わる
    const { result } = playOnce(randomBot(1), {
      seed: 1,
      maxTicks: 30 * TICK_HZ,
      setup: { bodies: [at(7, 130, 0), at(6, 280, 0), at(5, 400, 0)], heat: 70, bestTier: 8 },
    });
    expect(result.heat75Count).toBeGreaterThanOrEqual(1);
    // 打ち切りではなく終了で止まった
    expect(result.timedOut).toBe(false);
  });

  it('返した sim から入力ログを取れる（再生の検証用）', () => {
    const { sim, result } = playOnce(randomBot(2), { seed: 2, maxTicks: 10 * TICK_HZ });
    expect(sim.getInputLog()).toHaveLength(result.launches);
  });
});

describe('runBatch', () => {
  it('シードを変えて N 回まわす', () => {
    const runs = runBatch(randomBot, { runs: 4, seedStart: 10, maxTicks: 15 * TICK_HZ });
    expect(runs.map((r) => r.seed)).toEqual([10, 11, 12, 13]);
  });

  it('同じ条件なら結果が完全に一致する', () => {
    const a = runBatch(randomBot, { runs: 3, seedStart: 5, maxTicks: 15 * TICK_HZ });
    const b = runBatch(randomBot, { runs: 3, seedStart: 5, maxTicks: 15 * TICK_HZ });
    expect(a).toEqual(b);
  });
});

describe('summarizeRuns', () => {
  it('各指標の分布を返す', () => {
    const runs = runBatch(randomBot, { runs: 4, seedStart: 10, maxTicks: 15 * TICK_HZ });
    const s = summarizeRuns(runs);
    expect(s.seconds.n).toBe(4);
    expect(s.seconds.mean).toBeGreaterThan(0);
    expect(s.score.min).toBeLessThanOrEqual(s.score.max);
    expect(s.bestTier.median).toBeGreaterThanOrEqual(0);
    expect(s.merges.mean).toBeGreaterThanOrEqual(0);
    expect(s.heat75Count.max).toBeGreaterThanOrEqual(0);
  });
});
