import { expect, it } from 'vitest';
import { createSimulation } from '../game/simulation';
import { DROP_SPEED, TICK_HZ } from '../game/constants';
import { setupTwoChain } from './chains';

it('待つ間に回った練習盤面でも、動いた相手へ一投すれば本物の2連鎖で冷却できる', () => {
  const sim = createSimulation(21, setupTwoChain());
  for (let i = 0; i < 2 * TICK_HZ; i++) sim.stepFixed();
  expect(sim.getSnapshot().stats.merges).toBe(0);
  const target = sim.getSnapshot().bodies.find((b) => b.tier === 0)!;
  const angle = Math.atan2(target.y, target.x);
  expect(Math.abs(angle + Math.PI / 2)).toBeGreaterThan(.2);
  expect(sim.submitLaunch({ originAngleRadians: angle, vx: -Math.cos(angle) * DROP_SPEED, vy: -Math.sin(angle) * DROP_SPEED }).accepted).toBe(true);
  const events = Array.from({ length: 3 * TICK_HZ }, () => sim.stepFixed()).flat().filter((e) => e.kind === 'merge');
  expect(events.map((e) => e.chain)).toEqual([1, 2]);
  expect(events.map((e) => e.heatDelta)).toEqual([-2, -5]);
  expect(sim.getSnapshot().stats.launches).toBe(1);
});
