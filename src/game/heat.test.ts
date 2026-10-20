import { describe, expect, it } from 'vitest';
import { DT, HEAT_COOL_PER_SECOND } from './constants';
import { fusionCooling } from './heat';
import { createSimulation, restoreSimulation } from './simulation';

describe('連鎖の冷却', () => {
  it('連鎖1から5で2/5/8/11/14、以降は増えない', () => {
    expect([1, 2, 3, 4, 5, 20].map((chain) => fusionCooling(100, chain))).toEqual([2, 5, 8, 11, 14, 14]);
  });
  it('残った熱だけを冷やし、超新星に通常の冷却を重ねない', () => {
    expect(fusionCooling(0, 5)).toBe(0);
    expect(fusionCooling(3, 5)).toBe(3);
    expect(fusionCooling(100, 5, true)).toBe(40);
    expect(fusionCooling(7, 5, true)).toBe(7);
  });
  it.each([1, 3, 5])('本物の合体のイベントと熱量が一致する（連鎖%d）', (chain) => {
    const initial = createSimulation(1, { heat: 70, bodies: [{ tier: 0, x: 100, y: -14 }, { tier: 0, x: 100, y: 14 }] }).exportState();
    const sim = restoreSimulation({ ...initial, bodies: initial.bodies.map((b, i) => i === 0 ? { ...b, chain: chain - 1, chainUntilTick: 300 } : b) });
    const events = sim.stepFixed();
    const merge = events.find((e) => e.kind === 'merge')!;
    expect(merge.chain).toBe(chain);
    expect(merge.heatDelta).toBe(-fusionCooling(70, chain));
    expect(sim.getSnapshot().heat).toBeCloseTo(70 + merge.heatDelta! - HEAT_COOL_PER_SECOND * DT, 10);
  });
  it('同じtickの2合体は残り熱を分け、0未満の差分を出さない', () => {
    const sim = createSimulation(1, { heat: 3, bodies: [
      { tier: 0, x: 100, y: -14 }, { tier: 0, x: 100, y: 14 },
      { tier: 0, x: -100, y: -14 }, { tier: 0, x: -100, y: 14 },
    ] });
    expect(sim.stepFixed().filter((e) => e.kind === 'merge').map((e) => e.heatDelta)).toEqual([-2, -1]);
    expect(sim.getSnapshot().heat).toBe(0);
  });
  it.each([0, 7, 60])('超新星も実際に冷えた量だけを伝える（熱%d）', (heat) => {
    const sim = createSimulation(1, { heat, bodies: [{ tier: 8, x: 140, y: -100 }, { tier: 8, x: 140, y: 100 }] });
    const e = sim.stepFixed().find((event) => event.kind === 'supernova')!;
    expect(e.heatDelta).toBe(0 - Math.min(heat, 40));
    expect(Object.is(e.heatDelta, -0)).toBe(false);
  });
});
