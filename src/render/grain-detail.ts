// 物理には使わない。IDから見た目だけを決め、同じ粒の向きを保つ。
export function grainPose(seed = 0): { angle: number; variation: number } {
  let hash = (seed >>> 0) ^ 0x9e3779b9;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return { angle: hash / 0x100000000 * Math.PI * 2, variation: hash % 3 };
}

export function grainResolution(radius: number, pixelScale: number): number {
  const diameter = Math.max(1, radius * 2 * pixelScale);
  return Math.min(1024, Math.max(32, 2 ** Math.ceil(Math.log2(diameter))));
}
