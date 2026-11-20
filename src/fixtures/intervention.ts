import type { SimulationSetup } from '../game/simulation';
import { BURST_MAX, INTERVENTION_UNLOCK_TIER, TIER_RADIUS } from '../game/constants';

/** 操作の練習用。合体12組がゲージを実際に満たす、最高Tier3の途中盤面。 */
export function setupInterventionPractice(): SimulationSetup {
  const bodies: NonNullable<SimulationSetup['bodies']>[number][] = [];
  for (let pair = 0; pair < BURST_MAX; pair++) {
    const angle = pair * Math.PI * 2 / BURST_MAX, r = 180;
    for (const side of [-1, 1]) bodies.push({ tier: 0,
      x: Math.cos(angle) * r - Math.sin(angle) * side * TIER_RADIUS[0],
      y: Math.sin(angle) * r + Math.cos(angle) * side * TIER_RADIUS[0] });
  }
  return { bodies, bestTier: INTERVENTION_UNLOCK_TIER, heat: 80, queue: [0, 0, 0] };
}
