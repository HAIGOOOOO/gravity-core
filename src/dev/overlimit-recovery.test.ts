import { expect, it } from 'vitest';
import { randomBot } from '../tools/bots';
import { measureOver, measureOverBatch } from '../tools/overlimit';
import { TICK_HZ } from '../game/constants';

it('限界外に残った終了と、実際に内側へ回復した盤面を分けて計測する', () => {
  const setup = { bodies: [{ tier: 7 as const, x: 130, y: 0 }, { tier: 6 as const, x: 280, y: 0 }, { tier: 5 as const, x: 400, y: 0 }], heat: 95, bestTier: 8 as const };
  const outcomes = [5, 6].map(seed => measureOver(randomBot(seed), { seed, maxTicks: 30 * TICK_HZ, setup }));
  expect(outcomes.map(o => o.summary.openAtEnd)).toEqual(outcomes.map(o => o.sim.getSnapshot().overLimit));
  expect(outcomes[0]!.sim.getSnapshot().phase).toBe('over');
  expect(outcomes[1]!.sim.getSnapshot()).toMatchObject({ phase: 'active', heat: 0, overLimit: false });
  expect(outcomes[1]!.summary.episodes.some(e => e.endTick !== null)).toBe(true);
  const batch = measureOverBatch(randomBot, { runs: 2, seedStart: 5, maxTicks: 30 * TICK_HZ, setup });
  expect(batch.summary.overRate).toBe(1);
  expect(batch.summaries.map(s => s.openAtEnd)).toEqual([true, false]);
  expect(batch.summary.openAtEndRate).toBe(.5);
});
