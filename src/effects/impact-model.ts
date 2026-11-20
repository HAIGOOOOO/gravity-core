import type { JuiceBurst } from '../render/juice-model';

export const IMPACT_COLORS = ['#ff5a3c', '#ff8a45', '#ffb35c', '#ffd88a', '#fff1d0', '#f2f4ff', '#cfdcff', '#a9c2ff', '#8fb0ff'] as const;
export const IMPACT_GRID = 64;

/** 同じ事件の段で、届く距離・余韻・飛散・揺れを一緒に変える。 */
export function impactProfile(burst: JuiceBurst) {
  const stage = Math.min(5, Math.max(1, burst.chain));
  return {
    stage,
    duration: burst.supernova ? 1.9 : .7 + (stage - 1) * .2,
    waves: burst.supernova ? 10 : stage + 3,
    particles: burst.supernova ? 340 : 40 + stage * 38,
    reach: burst.supernova ? 1500 : 900 + stage * 90,
    pointSize: burst.supernova ? 13 : 5.5 + stage * 1.1,
    color: IMPACT_COLORS[burst.tier],
  };
}

export function impactEnvelope(age: number, duration: number): number {
  return Math.max(0, Math.min(1, age / .065, (duration - age) / (duration * .72)));
}
