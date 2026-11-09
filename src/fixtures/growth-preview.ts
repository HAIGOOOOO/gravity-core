import type { LaunchCommand } from '../contracts/game';
import type { SimulationSetup } from '../game/simulation';

/** 成長の押しのけを読むための途中盤面。実際の未来とは区別する。 */
export function setupGrowthPreview(): SimulationSetup {
  return { bestTier: 6, queue: [4, 0, 0], heat: 80, bodies: [
    { tier: 4, x: 82, y: -41 }, { tier: 3, x: 155, y: 0 }, { tier: 6, x: 253, y: 0 },
  ] };
}
// この配置で予告だけでなく、実際にも65tick目にTier4同士が合体する照準。
export const GROWTH_PREVIEW_COMMAND: LaunchCommand = { originAngleRadians: Math.PI * 5 / 3, vx: 104, vy: 386 };
