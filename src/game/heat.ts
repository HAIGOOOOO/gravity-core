import { HEAT_CHAIN_COOL_MAX_STEPS, HEAT_CHAIN_COOL_STEP, HEAT_MERGE_COOL, HEAT_SUPERNOVA } from './constants';

/** 超新星は通常合体の冷却を重ねない。熱0の時に架空の冷却量を表示しない。 */
export function fusionCooling(heat: number, chain: number, supernova = false): number {
  const steps = Math.min(HEAT_CHAIN_COOL_MAX_STEPS, Math.max(0, chain - 1));
  const amount = supernova ? HEAT_SUPERNOVA : HEAT_MERGE_COOL + steps * HEAT_CHAIN_COOL_STEP;
  return Math.min(Math.max(0, heat), amount);
}
