import { AUDIO_MASTER_GAIN, AUDIO_MAX_VOICES, LAND_SOUND_MAX, LAND_SOUND_WINDOW_SECONDS } from '../game/constants';

// 同時数・着地の間隔・全体倍率は constants.ts の値を使う。音色は担当 C 内に置く。小さな山で鳴らし、重なっても耳に刺さらないようにする。
export const AUDIO = {
  maxVoices: AUDIO_MAX_VOICES, landWindow: LAND_SOUND_WINDOW_SECONDS, landCount: LAND_SOUND_MAX,
  attack: 0.005, floor: 0.0001, master: AUDIO_MASTER_GAIN, smoothing: 0.015,
  novaSilence: 0.15, criticalHz: 70, criticalSeconds: 0.12, criticalInterval: 1000,
};

export function masterVolume(volume: number): number {
  return (Number.isFinite(volume) ? Math.min(100, Math.max(0, volume)) : 0) / 100 * AUDIO.master;
}

export function mergeFrequency(tier: number): number {
  return 523 * 2 ** (-tier / 6);
}

export function mergeDuration(tier: number): number { return 0.2 + 0.05 * tier; }
export function chainFrequency(tier: number, chain: number): number {
  return mergeFrequency(tier) * 2 * 2 ** (Math.max(0, chain - 1) / 6);
}

export function createRateGate(limit: number, seconds: number) {
  const accepted = new Float64Array(limit).fill(-Infinity);
  let cursor = 0;
  return {
    accept(now: number): boolean {
      if (now - accepted[cursor] < seconds) return false;
      accepted[cursor] = now;
      cursor = (cursor + 1) % limit;
      return true;
    },
    reset(): void { accepted.fill(-Infinity); cursor = 0; },
  };
}
