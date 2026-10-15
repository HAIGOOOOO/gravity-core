export const DIRECTIONS = ['mineral', 'pressure', 'musical'] as const;
export type Direction = typeof DIRECTIONS[number];
export const SCENES = ['drop', 'impact', 'small', 'large', 'limit', 'ending'] as const;
export type SoundScene = typeof SCENES[number];
export const LAB_RATE = 48000;
export const LAB_SECONDS = 2.4;
const TAU = Math.PI * 2;

type Partial = { hz: number; endHz?: number; gain: number; length: number; at?: number; attack?: number; wobble?: number; glideSeconds?: number };

/** 全音の立ち上がり・末尾を連続にし、打撃の強さをクリックで代用しない。 */
function envelope(t: number, length: number, attack: number): number {
  if (t < 0 || t >= length) return 0;
  const rise = Math.sin(Math.min(1, t / attack) * Math.PI / 2) ** 2;
  return rise * Math.exp(-4 * t / length) * Math.min(1, (length - t) / 0.025);
}

function addPartial(data: Float32Array, rate: number, part: Partial): void {
  const offset = Math.round((part.at ?? 0) * rate);
  let phase = 0;
  for (let i = 0; i < part.length * rate && i + offset < data.length; i++) {
    const t = i / rate;
    const hz = part.hz * ((part.endHz ?? part.hz) / part.hz) ** Math.min(1, t / (part.glideSeconds ?? part.length));
    phase += TAU * hz / rate;
    const tremolo = part.wobble ? 0.8 + 0.2 * Math.cos(TAU * part.wobble * t) : 1;
    data[i + offset] += Math.sin(phase) * envelope(t, part.length, part.attack ?? 0.012) * part.gain * tremolo;
  }
}

function mineral(data: Float32Array, rate: number, scene: SoundScene): void {
  const base = { drop: 650, impact: 280, small: 440, large: 95, limit: 370, ending: 185 }[scene];
  const length = { drop: 0.24, impact: 0.3, small: 0.56, large: 1.8, limit: 1.05, ending: 1.65 }[scene];
  const ratios = [1, 1.483, 2.137, 3.79, 5.21];
  ratios.forEach((ratio, i) => {
    const converge = scene === 'small' || scene === 'large';
    addPartial(data, rate, { hz: base * ratio * (converge ? 1.12 : 1),
      endHz: base * ratio * (scene === 'drop' ? 0.5 : scene === 'ending' ? 0.36 : 1),
      gain: (scene === 'large' ? 0.15 : 0.22) / (1 + i * 1.4), length: length / (1 + i * 0.23),
      glideSeconds: converge ? GROW_SECONDS : undefined, wobble: scene === 'limit' ? 12 : 2 });
    if (converge) addPartial(data, rate, { hz: base * ratio * 0.88, endHz: base * ratio,
      gain: 0.1 / (i + 1), length: length / (1 + i * 0.3), at: 0.025, glideSeconds: GROW_SECONDS - 0.025 });
  });
  if (scene === 'limit') addPartial(data, rate, { hz: base + 18, gain: 0.12, length: 0.95 });
  if (scene === 'large' || scene === 'ending') {
    // 小さいスピーカーにも出来事が届くよう、低い胴と同じ動きの中域を残す。
    [3.13, 4.77, 7.09].forEach((ratio, i) => addPartial(data, rate, {
      hz: base * ratio, endHz: base * ratio * (scene === 'ending' ? 0.5 : 1.04),
      gain: (scene === 'large' ? 0.25 : 0.17) / (1 + i * 0.7), length: (scene === 'large' ? 1 : 0.7) / (1 + i * 0.2), at: 0.008,
    }));
  }
}

function pressure(data: Float32Array, rate: number, scene: SoundScene, seed: number): void {
  const length = { drop: 0.28, impact: 0.18, small: 0.55, large: 1.5, limit: 1.2, ending: 1.15 }[scene];
  const cutoff = { drop: 1300, impact: 1000, small: 1500, large: 900, limit: 800, ending: 900 }[scene];
  let state = seed >>> 0 || 1;
  let low = 0;
  let slower = 0;
  for (let i = 0; i < length * rate; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    const noise = (state >>> 0) / 2147483648 - 1;
    const t = i / rate;
    const moving = cutoff * (scene === 'large' ? 0.4 + 1.4 * t / length : 1 - 0.7 * t / length);
    const coefficient = 1 - Math.exp(-TAU * moving / rate);
    low += coefficient * (noise - low);
    slower += coefficient * 0.2 * (noise - slower);
    const grains = scene === 'small' ? 0.35 + 0.65 * Math.sin(TAU * (20 * t + 18 * t * t)) ** 8
      : scene === 'limit' ? 0.15 + 0.85 * Math.sin(TAU * 4 * t) ** 4
      : scene === 'ending' ? Math.max(0, 1 - t / 0.65) : 1;
    const attack = scene === 'drop' ? 0.075 : 0.016;
    const colored = low - slower * 0.5;
    const softened = scene === 'impact' || scene === 'ending' ? Math.tanh(colored * 4) / 4 : colored;
    data[i] += softened * envelope(t, length, attack) * (scene === 'drop' ? 0.35 : scene === 'limit' ? 0.5 : 0.8) * grains;
  }
  addPartial(data, rate, { hz: scene === 'drop' ? 650 : scene === 'large' ? 65 : scene === 'ending' ? 220 : 160,
    endHz: scene === 'drop' ? 210 : scene === 'large' ? 125 : scene === 'ending' ? 40 : 65,
    gain: scene === 'drop' ? 0.07 : scene === 'large' ? 0.09 : scene === 'limit' ? 0.08 : 0.14,
    length: length * 0.85, attack: scene === 'drop' ? 0.035 : 0.02 });
  if (scene === 'large') addPartial(data, rate, { hz: 420, endHz: 680, gain: 0.2, length: 0.65, at: 0.06 });
  if (scene === 'limit') for (let i = 0; i < 4; i++) {
    addPartial(data, rate, { hz: 740, endHz: 680, gain: 0.24, length: 0.11, at: i * 0.25, attack: 0.015 });
  }
}

function musical(data: Float32Array, rate: number, scene: SoundScene): void {
  if (scene === 'drop') {
    addPartial(data, rate, { hz: 784, endHz: 392, gain: 0.19, length: 0.18, attack: 0.012 });
    return;
  }
  const notes = { drop: [784, 523], impact: [262], small: [523, 659, 784],
    large: [131, 262, 330, 392, 523], limit: [440, 466, 440, 466], ending: [392, 330, 262, 131] }[scene];
  const spacing = scene === 'large' ? 0.04 : scene === 'ending' ? 0.15 : scene === 'limit' ? 0.18 : 0.055;
  notes.forEach((hz, note) => {
    [1, 4, 10].forEach((ratio, harmonic) => addPartial(data, rate, {
      hz: hz * ratio, gain: (note === 0 ? scene === 'large' ? 0.18 : 0.3 : scene === 'small' ? 0.09 : scene === 'large' ? 0.04 : 0.065) / (1 + harmonic * 5),
      length: (scene === 'large' || scene === 'ending' ? 1.2 : 0.38) / (1 + harmonic),
      at: scene === 'small' && note > 0 ? 0.09 : note * spacing, attack: 0.01,
    }));
  });
  if (scene === 'large') [523, 784].forEach((hz, i) => addPartial(data, rate, {
    hz, gain: 0.22 / (i + 1), length: 0.8, at: 0, attack: 0.012,
  }));
}

export function synthesizeDirection(direction: Direction, scene: SoundScene, seed = 57, rate = LAB_RATE): Float32Array<ArrayBuffer> {
  const data = new Float32Array(Math.ceil(rate * LAB_SECONDS));
  if (direction === 'mineral') mineral(data, rate, scene);
  else if (direction === 'pressure') pressure(data, rate, scene, seed);
  else musical(data, rate, scene);
  return data;
}

/** 聴取と測定は、この同じ出力済みバッファを使う。 */
export async function renderDirection(direction: Direction, scene: SoundScene, seed = 57): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(1, LAB_RATE * LAB_SECONDS, LAB_RATE);
  const buffer = context.createBuffer(1, LAB_RATE * LAB_SECONDS, LAB_RATE);
  buffer.copyToChannel(synthesizeDirection(direction, scene, seed), 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = 6000; filter.Q.value = 0.5;
  const gain = context.createGain(); gain.gain.value = 0.8;
  source.connect(filter).connect(gain).connect(context.destination);
  source.start();
  return context.startRendering();
}
import { GROW_SECONDS } from '../game/constants';

