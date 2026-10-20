import type { SimulationSetup } from '../game/simulation';
import { CORE_RADIUS, TIER_RADIUS } from '../game/constants';

/** 真上からの一投で、合体した天体が隣の相手へ繋がる。連鎖数は仕込まない。 */
export function setupTwoChain(): SimulationSetup {
  const up = -Math.PI / 2, adjacent = up + 0.55;
  const r0 = CORE_RADIUS + TIER_RADIUS[0], r1 = CORE_RADIUS + TIER_RADIUS[1];
  return { heat: 80, queue: [0, 0, 0], bodies: [
    { tier: 0, x: Math.cos(up) * r0, y: Math.sin(up) * r0 },
    { tier: 1, x: Math.cos(adjacent) * r1, y: Math.sin(adjacent) * r1 },
  ] };
}
