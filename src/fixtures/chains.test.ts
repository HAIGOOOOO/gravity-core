import { expect, it } from 'vitest';
import { createSimulation } from '../game/simulation';
import { DROP_SPEED, TICK_HZ } from '../game/constants';
import { setupTwoChain } from './chains';

it('練習盤面は待ってから真上へ一投しても、本物の2連鎖で冷却できる', () => {
  const sim = createSimulation(21, setupTwoChain());
  for (let i = 0; i < 2 * TICK_HZ; i++) sim.stepFixed();
  expect(sim.getSnapshot().stats.merges).toBe(0);
  expect(sim.submitLaunch({ originAngleRadians: -Math.PI / 2, vx: 0, vy: DROP_SPEED }).accepted).toBe(true);
  const events = Array.from({ length: 3 * TICK_HZ }, () => sim.stepFixed()).flat().filter((e) => e.kind === 'merge');
  expect(events.map((e) => e.chain)).toEqual([1, 2]);
  expect(events.map((e) => e.heatDelta)).toEqual([-2, -5]);
  expect(sim.getSnapshot().stats.launches).toBe(1);
});
