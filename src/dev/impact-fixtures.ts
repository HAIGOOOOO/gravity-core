import type { SimulationSetup } from '../game/simulation';
import { CORE_RADIUS, TIER_RADIUS } from '../game/constants';
import { createJuiceChain } from './juice-chain';

export type ImpactScene = 'merge' | 'chain' | 'nova';

/** デモと本体検証が同じ初期配置を使い、得点と連鎖を実計算する。 */
export function impactSetup(scene: ImpactScene): SimulationSetup {
  if (scene === 'chain') {
    return { heat: 70, bodies: createJuiceChain().getSnapshot().bodies.map(({ tier, x, y }) => ({ tier, x, y })) };
  }
  const tier = scene === 'nova' ? 8 : 2, radius = TIER_RADIUS[tier];
  return { heat: 86, bodies: [
    { tier, x: -radius * .99, y: -CORE_RADIUS - radius * 2 },
    { tier, x: radius * .99, y: -CORE_RADIUS - radius * 2 },
    { tier: 4, x: -180, y: 110 }, { tier: 6, x: 190, y: 90 },
  ] };
}
