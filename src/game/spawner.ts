// 次の天体の抽選（SPEC.md 4.3）。乱数を使うのはここだけ。

import type { Tier } from '../contracts/game';
import { QUEUE_TABLE } from './constants';
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
