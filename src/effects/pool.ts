import { FLOAT_TEXT_CAP, PARTICLE_CAP } from '../game/constants';
import { dampedTravel, dampedVelocity, FLOAT_SECONDS, safeDelta } from './motion';

export const RING_CAP = FLOAT_TEXT_CAP * 2;

type Lifetime = { active: boolean; age: number; lifetime: number };
export type Particle = Lifetime & {
  x: number; y: number; vx: number; vy: number; size: number; color: string;
};
export type Ring = Lifetime & {
  x: number; y: number; startRadius: number; endRadius: number;
  width: number; color: string; stationary: boolean;
};
export type FloatText = Lifetime & {
  x: number; y: number; text: string; color: string;
};

function unused<T extends Lifetime>(slots: T[]): T | undefined {
  for (const slot of slots) if (!slot.active) return slot;
  return undefined;
}

export function createEffectPool() {
  // 出来事が重なっても配列や描画用の物を増やさず、空いた枠だけ使う。
  const particles: Particle[] = Array.from({ length: PARTICLE_CAP }, () => ({
    active: false, age: 0, lifetime: 0, x: 0, y: 0, vx: 0, vy: 0, size: 0, color: '',
  }));
  const rings: Ring[] = Array.from({ length: RING_CAP }, () => ({
    active: false, age: 0, lifetime: 0, x: 0, y: 0, startRadius: 0, endRadius: 0,
    width: 0, color: '', stationary: false,
  }));
  const texts: FloatText[] = Array.from({ length: FLOAT_TEXT_CAP }, () => ({
    active: false, age: 0, lifetime: FLOAT_SECONDS, x: 0, y: 0, text: '', color: '',
  }));

  function advanceLifetimes(slots: Lifetime[], dt: number): void {
    for (const slot of slots) {
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= slot.lifetime) slot.active = false;
    }
  }

  return {
    particles, rings, texts,
    particle(x: number, y: number, vx: number, vy: number, size: number, color: string, lifetime: number): boolean {
      const slot = unused(particles);
      if (!slot) return false;
      slot.active = true; slot.age = 0; slot.lifetime = lifetime;
      slot.x = x; slot.y = y; slot.vx = vx; slot.vy = vy;
      slot.size = size; slot.color = color;
      return true;
    },
    ring(x: number, y: number, start: number, end: number, width: number, color: string, lifetime: number, stationary = false): boolean {
      const slot = unused(rings);
      if (!slot) return false;
      slot.active = true; slot.age = 0; slot.lifetime = lifetime;
      slot.x = x; slot.y = y; slot.startRadius = start; slot.endRadius = end;
      slot.width = width; slot.color = color; slot.stationary = stationary;
      return true;
    },
    text(x: number, y: number, text: string, color: string): boolean {
      const slot = unused(texts);
      if (!slot) return false;
      slot.active = true; slot.age = 0; slot.x = x; slot.y = y;
      slot.text = text; slot.color = color;
      return true;
    },
    update(seconds: number): void {
      const dt = safeDelta(seconds);
      for (const slot of particles) {
        if (!slot.active) continue;
        const travelSeconds = Math.min(dt, slot.lifetime - slot.age);
        slot.x += dampedTravel(slot.vx, travelSeconds);
        slot.y += dampedTravel(slot.vy, travelSeconds);
        slot.vx = dampedVelocity(slot.vx, travelSeconds);
        slot.vy = dampedVelocity(slot.vy, travelSeconds);
        slot.age += dt;
        if (slot.age >= slot.lifetime) slot.active = false;
      }
      advanceLifetimes(rings, dt);
      advanceLifetimes(texts, dt);
    },
    clear(): void {
      for (const slot of particles) slot.active = false;
      for (const slot of rings) slot.active = false;
      for (const slot of texts) slot.active = false;
    },
  };
}

export type EffectPool = ReturnType<typeof createEffectPool>;
