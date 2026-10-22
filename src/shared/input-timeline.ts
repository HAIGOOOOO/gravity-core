import type { LaunchInput } from '../contracts/game';
import { INTERVENTION_WINDOW_SECONDS, TICK_HZ } from '../game/constants';

export type InputAction =
  | Readonly<{ tick: number; kind: 'launch'; input: LaunchInput }>
  | Readonly<{ tick: number; kind: 'collapse' }>;

/** 崩壊を直前の射出へ結び、同tickの「崩壊→次の射出」の順も保存する。 */
export function expandLaunchInputs(inputs: readonly LaunchInput[], endTick: number): InputAction[] | null {
  const actions: InputAction[] = [];
  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index]!;
    actions.push({ kind: 'launch', tick: input.tick, input });
    const tick = input.collapseTick;
    if (tick === undefined) continue;
    if (!Number.isSafeInteger(tick) || tick < input.tick || tick > endTick ||
      tick > (inputs[index + 1]?.tick ?? endTick) ||
      tick - input.tick >= Math.round(INTERVENTION_WINDOW_SECONDS * TICK_HZ)) return null;
    actions.push({ kind: 'collapse', tick });
  }
  return actions;
}
