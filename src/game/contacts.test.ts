import { describe, expect, it } from 'vitest';
import { solveContacts } from './contacts';
import { DT, TICK_HZ } from './constants';
import { createSimulation, restoreSimulation } from './simulation';

describe('合体の押しのけ', () => {
  it('成長と無関係な接触では従来の位置補正を速度に残す', () => {
    const a = { id: 1, radius: 14, px: 100, py: 0, growLeft: 0, touching: false, landed: true };
    const b = { ...a, id: 2, px: 120 };
    expect(solveContacts([a, b]).size).toBe(0);
    expect(b.px - a.px).toBeCloseTo(28);
  });
  it('成長の補正は接している山へ伝わるが、飛来した天体から衝突速度を引かない', () => {
    const a = { id: 1, radius: 20, px: 100, py: 0, growLeft: DT, touching: false, landed: true };
    const b = { ...a, id: 2, px: 138, growLeft: 0 }, c = { ...b, id: 3, px: 176, landed: false };
    const growth = solveContacts([a, b, c]);
    expect(growth.has(1) && growth.has(2)).toBe(true);
    expect(growth.has(3)).toBe(false);
    expect(c.px).toBeGreaterThan(176);
  });
  it('核の表面への成長補正も、射出のような外向き速度を生まない', () => {
    const state = createSimulation(1, { bodies: [{ tier: 5, x: 85, y: 0 }] }).exportState();
    const sim = restoreSimulation({ ...state, bodies: state.bodies.map((b) => ({ ...b, radius: 41, growFrom: 41, growLeft: 0.12 })) });
    sim.stepFixed();
    const b = sim.getSnapshot().bodies[0]!;
    expect(b.x).toBeGreaterThan(85);
    expect(b.vx).toBeLessThanOrEqual(0);
  });
  it('熱99.9で限界内の山を合体しても、成長の勢いだけで飛び出して負けない', () => {
    const state = createSimulation(9, { heat: 99.9, bodies: [
      { tier: 4, x: 82, y: -41 }, { tier: 4, x: 82, y: 41 },
      { tier: 3, x: 155, y: 0 }, { tier: 6, x: 253 * Math.cos(0.12), y: 253 * Math.sin(0.12) },
    ] }).exportState();
    const sim = restoreSimulation({ ...state, bodies: state.bodies.map((b) => ({ ...b, bornTick: -2 * TICK_HZ })) });
    let peak = 0;
    for (let i = 0; i < 3 * TICK_HZ; i++) {
      sim.stepFixed(); const b = sim.getSnapshot().bodies.find((body) => body.id === 4)!;
      peak = Math.max(peak, (b.x * b.vx + b.y * b.vy) / Math.hypot(b.x, b.y));
    }
    expect(peak).toBeLessThan(5);
    expect(sim.getSnapshot().phase).toBe('active');
    expect(sim.getSnapshot().overLimit).toBe(false);
  });
});
