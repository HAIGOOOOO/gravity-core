import { describe, expect, it } from 'vitest';
import type { Prediction } from '../contracts/game';
import { mergePreview } from './merge-preview';
import { createSimulation } from './simulation';
import { DROP_SPEED } from './constants';
import { GROWTH_PREVIEW_COMMAND, setupGrowthPreview } from '../fixtures/growth-preview';

describe('合体の成長後の目安', () => {
  it('見本の照準は予告だけでなく実際に合体して成長する', () => {
    const sim = createSimulation(31, setupGrowthPreview());
    expect(sim.predict(GROWTH_PREVIEW_COMMAND).mergePreview?.mayCrossLimit).toBe(true);
    expect(sim.submitLaunch(GROWTH_PREVIEW_COMMAND).accepted).toBe(true);
    let merged = false;
    for (let tick = 0; tick < 240; tick++) {
      if (sim.stepFixed().some((e) => e.kind === 'merge' && e.sourceTier === 4 && e.resultTier === 5)) merged = true;
    }
    expect(merged).toBe(true);
    expect(sim.getSnapshot().bodies.some((b) => b.tier === 5 && b.radius === 52)).toBe(true);
  });
  const path: Prediction = { valid: true, points: [{ x: 82, y: 41, t: 0.5 }], end: 'body', hitBodyId: 1, willMerge: true };
  it('限界内だった山を成長で外へ押す配置を、実状態を変えずに示す', () => {
    const sim = createSimulation(1, { queue: [4, 0, 0], bodies: [
      { tier: 4, x: 82, y: -41 }, { tier: 3, x: 155, y: 0 }, { tier: 6, x: 253, y: 0 },
    ] });
    const before = sim.exportState(), preview = mergePreview(sim.getSnapshot(), path)!;
    expect(preview.tier).toBe(5); expect(preview.radius).toBe(52);
    expect(preview.mayCrossLimit).toBe(true); expect(preview.pushed.map((b) => b.id)).toContain(3);
    expect(sim.exportState()).toEqual(before);
  });
  it('余裕のある配置では限界越えを付けず、実際の照準にも成長先が付く', () => {
    const sim = createSimulation(1);
    const before = sim.exportState(), prediction = sim.predict({ originAngleRadians: -Math.PI / 2, vx: 0, vy: DROP_SPEED });
    expect(prediction.mergePreview?.tier).toBe(1);
    expect(prediction.mergePreview?.mayCrossLimit).toBe(false);
    expect(sim.exportState()).toEqual(before);
  });
  it('超新星・違う階級・重力操作中の不確かな当たり先では、膨張を捏造しない', () => {
    const sim = createSimulation(1, { queue: [8, 0, 0], bodies: [{ tier: 8, x: 144, y: 0 }] });
    expect(mergePreview(sim.getSnapshot(), path)).toBeUndefined();
    expect(mergePreview(createSimulation(1).getSnapshot(), { ...path, willMerge: false })).toBeUndefined();
    expect(mergePreview(createSimulation(1).getSnapshot(), { ...path, uncertain: true })).toBeUndefined();
  });
});
