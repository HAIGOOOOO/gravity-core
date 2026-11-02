import type { JuiceBurst } from './juice-model';

function random(seed: number, index: number): number {
  const value = Math.sin(seed * 1.71 + index * 79.13) * 43758.5453;
  return value - Math.floor(value);
}

/** 面と陰面は必ず同じ殻を使う。形と影が別の場所を走らないため。 */
export function juiceShards(burst: JuiceBurst, time: number) {
  const peak = burst.supernova || burst.chain >= 5, jet = burst.direction === 'jet';
  const strength = 1 + (Math.min(5, burst.chain) - 1) * .3 + burst.tier * .075 + (burst.supernova ? .8 : 0);
  const travel = Math.max(0, time - .08), reach = (1 - Math.exp(-travel * 5)) * 105 * strength;
  const rotation = jet ? Math.atan2(burst.y, burst.x) + Math.PI / 2 : burst.angle;
  const count = peak ? 20 : 7;
  return Array.from({ length: count }, (_, i) => {
    const angle = rotation + (jet ? (i % 2 ? Math.PI : 0) + (random(burst.seed, i) - .5) * .55 : i / count * Math.PI * 2 + (random(burst.seed, i) - .5) * .3);
    const radius = reach * (burst.direction === 'echo' ? .35 : 1) * (.65 + random(burst.seed, i) * .65);
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, angle: angle + travel * 2, size: (7 + random(burst.seed, i + 2) * 9) * (peak ? 2.8 : 1) };
  });
}
