export const FLOAT_SECONDS = 1.2;
export const FLOAT_RISE = 24;
export const PARTICLE_DAMPING = 3.8;
export const REDUCED_RING_SECONDS = 0.3;

export function safeDelta(seconds: number): number {
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
}

export function lifeProgress(age: number, lifetime: number): number {
  return lifetime > 0 ? Math.min(1, Math.max(0, age / lifetime)) : 1;
}

export function fade(age: number, lifetime: number): number {
  const remaining = 1 - lifeProgress(age, lifetime);
  return remaining * remaining;
}

export function floatOffset(age: number): number {
  return -FLOAT_RISE * lifeProgress(age, FLOAT_SECONDS);
}

export function ringRadius(start: number, end: number, progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return start + (end - start) * (1 - (1 - p) ** 3);
}

export function dampedVelocity(velocity: number, seconds: number): number {
  return velocity * Math.exp(-PARTICLE_DAMPING * safeDelta(seconds));
}

export function dampedTravel(velocity: number, seconds: number): number {
  // 指数減衰を積分して、フレームの分け方で飛距離が変わらないようにする。
  return (velocity - dampedVelocity(velocity, seconds)) / PARTICLE_DAMPING;
}
