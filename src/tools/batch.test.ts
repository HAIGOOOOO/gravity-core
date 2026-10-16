import { describe, expect, it } from 'vitest';
import { at } from '../fixtures/index';
import { TICK_HZ } from '../game/constants';
import { playOnce, runBatch, summarizeRuns } from './batch';
import { randomBot, type Bot } from './bots';

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
    // リングを越えた天体があったので、越えていた時間も記録される
    expect(result.overLimitSeconds).toBeGreaterThan(0);
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

  it('setup は全部の回に渡る（比較用の条件変更が 1 回だけに効く事はない）', () => {
    const runs = runBatch(randomBot, { runs: 3, seedStart: 20, maxTicks: 5 * TICK_HZ, setup: { bestTier: 8 } });
    expect(runs).toHaveLength(3);
    // bestTierThisRun は開始値がそのまま（Tier 8 同士は超新星で消え、9 以上にはならない）
    for (const r of runs) expect(r.bestTier).toBe(8);
  });

  it('0 回なら空を返す', () => {
    expect(runBatch(randomBot, { runs: 0 })).toEqual([]);
  });
});

describe('playOnce の抜けている場合', () => {
  it('上限 0 なら何もせずに終わる（打ち切り扱い）', () => {
    const { result } = playOnce(randomBot(1), { seed: 1, maxTicks: 0 });
    expect(result.ticks).toBe(0);
    expect(result.launches).toBe(0);
    expect(result.timedOut).toBe(true);
  });

  it('射出がいつも断られるボットでも、上限まで進んで止まる', () => {
    // 速さ 0 は必ず 'speed' で断られる → やり直しのたびに少し進むので、いつか上限に着く
    const stubborn: Bot = { name: 'stubborn', decide: () => ({ originAngleRadians: 0, vx: 0, vy: 0 }) };
    const { result, sim } = playOnce(stubborn, { seed: 1, maxTicks: 10 * TICK_HZ });
    expect(result.launches).toBe(0);
    expect(sim.getInputLog()).toHaveLength(0);
    expect(result.ticks).toBeGreaterThanOrEqual(10 * TICK_HZ);
    expect(result.timedOut).toBe(true);
  });

  it('setup の bestTier がシミュレーションに渡る', () => {
    const { sim } = playOnce(randomBot(1), { seed: 1, maxTicks: TICK_HZ, setup: { bestTier: 8 } });
    expect(sim.getSnapshot().bestTierThisRun).toBe(8);
  });

  it('合体効率は「合体数 ÷ 射出数」。撃てなければ 0、撃てば 0 以上', () => {
    // 撃てないボットは 0 射出 → 0 で割れないので 0
    const stubborn: Bot = { name: 'stubborn', decide: () => ({ originAngleRadians: 0, vx: 0, vy: 0 }) };
    const { result: none } = playOnce(stubborn, { seed: 1, maxTicks: 10 * TICK_HZ });
    expect(none.launches).toBe(0);
    expect(none.mergesPerLaunch).toBe(0);
    // 普通に撃てば効率は 0 以上（1 射で連鎖合体が起きると 1 を越えてよい）
    const { result: played } = playOnce(randomBot(1), { seed: 1, maxTicks: 20 * TICK_HZ });
    expect(played.launches).toBeGreaterThan(0);
    expect(played.mergesPerLaunch).toBeGreaterThanOrEqual(0);
    expect(played.mergesPerLaunch).toBe(played.merges / played.launches);
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
    expect(s.mergesPerLaunch.mean).toBeGreaterThanOrEqual(0);
  });

  it('0 件でも落ちない（値は NaN）', () => {
    const s = summarizeRuns([]);
    expect(s.seconds.n).toBe(0);
    expect(s.seconds.mean).toBeNaN();
    expect(s.merges.median).toBeNaN();
    expect(s.mergesPerLaunch.p90).toBeNaN();
  });
});
