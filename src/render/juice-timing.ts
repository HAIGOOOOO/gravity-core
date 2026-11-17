import type { EffectsLayer } from '../contracts/app';
import { juiceEnvelope, type JuiceBurst } from './juice-model';

function timing(burst: JuiceBurst): { stop: number; slow: number; scale: number } {
  if (burst.supernova) return { stop: .10, slow: .65, scale: .2 };
  if (burst.chain >= 5) return { stop: .075, slow: .48, scale: .3 };
  if (burst.chain >= 4 || burst.sourceTier >= 6) return { stop: .05, slow: .28, scale: .55 };
  if (burst.chain >= 2 || burst.sourceTier >= 3) return { stop: .025, slow: 0, scale: 1 };
  return { stop: 0, slow: 0, scale: 1 };
}

/** 実時間は止めず、天体の動きだけを止める。共有の上限は呼び出し側でも通す。 */
export function juiceTimeScale(burst: JuiceBurst, age: number, reduced = false): number {
  if (reduced) return 1;
  const { stop, slow, scale } = timing(burst), start = .095, end = start + stop;
  if (age >= start && age < end) return 0;
  if (age >= end && age < end + slow) return scale;
  if (slow > 0 && age >= end + slow && age < end + slow + .16) {
    return scale + (1 - scale) * (age - end - slow) / .16;
  }
  return 1;
}

/** 静止画でも、実時間から停止とスローの分を引いた同じ位置を再現する。 */
export function juiceMatterTime(burst: JuiceBurst, age: number, reduced = false): number {
  if (reduced) return .28;
  const { stop, slow, scale } = timing(burst), start = .095, end = start + stop;
  const held = Math.min(stop, Math.max(0, age - start));
  const slowed = Math.min(slow, Math.max(0, age - end));
  const recovery = slow > 0 ? Math.min(.16, Math.max(0, age - end - slow)) : 0;
  return Math.max(0, age - held - (1 - scale) * slowed - (1 - scale) * (recovery - recovery * recovery / .32));
}

export function juiceView(burst: JuiceBurst, age: number, reduced = false) {
  if (reduced) return { zoom: 1, x: 0, y: 0 };
  const weight = juiceEnvelope(age, .09, .16, .72);
  const heavy = burst.supernova || burst.chain >= 4 || burst.sourceTier >= 6;
  const zoom = 1 + weight * (heavy ? .022 : burst.chain >= 2 ? .008 : 0);
  const amplitude = heavy ? (burst.supernova ? 7 : 4.5) * weight : 0;
  const shift = Math.sin(age * 89) * amplitude;
  return { zoom, x: Math.cos(burst.angle) * shift, y: Math.sin(burst.angle) * shift };
}

export function createJuiceTiming(): Pick<EffectsLayer, 'update' | 'setReducedMotion' | 'clear'> & { start(burst: JuiceBurst): void; timeScale(): number } {
  let current: JuiceBurst | null = null, age = 0, reduced = false;
  return {
    start(burst) { current = burst; age = 0; },
    update(seconds) { age += Math.max(0, seconds); },
    timeScale() { return current ? juiceTimeScale(current, age, reduced) : 1; },
    setReducedMotion(on) { reduced = on; },
    clear() { current = null; age = 0; },
  };
}
