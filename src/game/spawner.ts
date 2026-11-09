// 次の天体。固定組の袋を混ぜ、引き切ってから補充する。

import type { Tier } from '../contracts/game';
import { QUEUE_BAG_SIZE, QUEUE_TABLE } from './constants';
import type { Rng } from './rng';

/** 到達した最高 Tier に対応する確率の並び（添字が Tier）。 */
export function queueWeights(bestTier: number): readonly number[] {
  let weights: readonly number[] = QUEUE_TABLE[0].weights;
  for (const row of QUEUE_TABLE) {
    if (bestTier >= row.minBest) weights = row.weights;
  }
  return weights;
}

/** キューに足す天体を 1 個抽選する。 */
export function drawTier(bestTier: number, rng: Rng): Tier {
  const weights = queueWeights(bestTier);
  let x = rng();
  for (let tier = 0; tier < weights.length; tier++) {
    x -= weights[tier]!;
    if (x < 0) return tier as Tier;
  }
  return 0;
}

export type TierBagState = readonly Tier[];

/** 到達Tierの変更で残りの袋を捨てない。キューの予告も途中で変えない。 */
export function createTierBag(rng: Rng, saved: TierBagState = []) {
  const remaining = [...saved];
  return {
    draw(bestTier: number): Tier {
      if (remaining.length === 0) {
        queueWeights(bestTier).forEach((weight, tier) => {
          for (let i = 0; i < Math.round(weight * QUEUE_BAG_SIZE); i++) remaining.push(tier as Tier);
        });
        for (let i = remaining.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [remaining[i], remaining[j]] = [remaining[j]!, remaining[i]!];
        }
      }
      return remaining.pop()!;
    },
    exportState: (): TierBagState => [...remaining],
  };
}
