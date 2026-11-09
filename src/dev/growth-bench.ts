import type { Tier } from '../contracts/game';
import { DT, HEAT_MAX, LIMIT_RADIUS, TICK_HZ, TIER_RADIUS } from '../game/constants';
import { createSimulation, restoreSimulation } from '../game/simulation';

// 合体前には限界内の、核沿いの3段積み。回転・ずれを変えた24盤面で比べる。
export function runGrowthBench(factory: typeof createSimulation = createSimulation, restore: typeof restoreSimulation = restoreSimulation) {
  const layouts: readonly [Tier, Tier, Tier, number][] = [[4, 3, 6, 82], [3, 2, 7, 73]];
  return layouts.flatMap(([parent, middle, outer, x]) => [-0.12, 0, 0.12].flatMap((offset) => [0, 1, 2, 3].map((turn) => {
    const rotate = (px: number, py: number) => { const a = turn * Math.PI / 2; return { x: px * Math.cos(a) - py * Math.sin(a), y: px * Math.sin(a) + py * Math.cos(a) }; };
    const m = x + TIER_RADIUS[parent] + TIER_RADIUS[middle];
    const r = m + TIER_RADIUS[middle] + TIER_RADIUS[outer];
    const initial = factory(9, { heat: HEAT_MAX - 0.1, bodies: [
      { tier: parent, ...rotate(x, -TIER_RADIUS[parent]) }, { tier: parent, ...rotate(x, TIER_RADIUS[parent]) },
      { tier: middle, ...rotate(m, 0) }, { tier: outer, ...rotate(r * Math.cos(offset), r * Math.sin(offset)) },
    ] }).exportState();
    const sim = restore({ ...initial, bodies: initial.bodies.map((b) => ({ ...b, bornTick: -2 * TICK_HZ })) });
    let peakOutward = 0, peakEdge = 0, outsideSeconds = 0;
    for (let i = 0; i < 3 * TICK_HZ && sim.getSnapshot().phase === 'active'; i++) {
      sim.stepFixed();
      const b = sim.getSnapshot().bodies.find((body) => body.id === 4)!;
      const distance = Math.hypot(b.x, b.y);
      peakOutward = Math.max(peakOutward, (b.x * b.vx + b.y * b.vy) / distance);
      peakEdge = Math.max(peakEdge, distance + b.radius);
      if (distance + b.radius > LIMIT_RADIUS) outsideSeconds += DT;
    }
    return { parent, offset, turn, initialEdge: r + TIER_RADIUS[outer], peakOutward, peakEdge, outsideSeconds, lost: sim.getSnapshot().phase === 'over' };
  })));
}
