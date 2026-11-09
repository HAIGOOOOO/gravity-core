import type { LaunchInput, Tier } from '../contracts/game';
import { BOARD_ROTATION_RADIANS_PER_SECOND, REPEAT_LAUNCH_ANGLE, REPEAT_LAUNCH_FREE_PREVIOUS,
  REPEAT_LAUNCH_HEAT_STEP, REPEAT_LAUNCH_MEMORY, REPEAT_LAUNCH_UNLOCK_TIER, TICK_HZ } from './constants';

export type RecentLaunch = Pick<LaunchInput, 'tick' | 'originAngleRadians'>;

/** 画面の同じ方角と、同じ山を追いかける連投の両方を数える。保存済み入力から復元できる。 */
export function launchHeating(tick: number, bestTier: Tier, inputs: readonly RecentLaunch[], angle: number): number {
  if (bestTier < REPEAT_LAUNCH_UNLOCK_TIER) return 0;
  const recent = inputs.slice(-REPEAT_LAUNCH_MEMORY);
  const near = (a: number) => Math.abs(Math.atan2(Math.sin(a - angle), Math.cos(a - angle))) <= REPEAT_LAUNCH_ANGLE;
  let world = 0, moving = 0;
  for (const input of recent) {
    if (near(input.originAngleRadians)) world++;
    const carried = input.originAngleRadians + BOARD_ROTATION_RADIANS_PER_SECOND * (tick - input.tick) / TICK_HZ;
    if (near(carried)) moving++;
  }
  return Math.max(0, Math.max(world, moving) - REPEAT_LAUNCH_FREE_PREVIOUS) * REPEAT_LAUNCH_HEAT_STEP;
}
