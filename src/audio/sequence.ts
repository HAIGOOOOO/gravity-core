import type { SoundScene } from './directions';

export const SCENE_SEQUENCE: readonly { scene: SoundScene; at: number }[] = [
  { scene: 'drop', at: 0 }, { scene: 'impact', at: 0.4 },
  { scene: 'small', at: 0.54 }, { scene: 'small', at: 0.95 },
  { scene: 'large', at: 1.35 }, { scene: 'limit', at: 2.2 }, { scene: 'ending', at: 3.05 },
];
const PRIORITY: Record<SoundScene, number> = { drop: 0, impact: 1, small: 2, large: 3, limit: 4, ending: 5 };
const DUCK_SECONDS = 0.025;
export const SEQUENCE_SECONDS = 5.45;
export const SEQUENCE_GAIN = 1;

/** 音と図に同じ混合結果を渡す。重要な出来事で古い余韻だけを25msかけて下げる。 */
export function mixSceneSequence(samples: ReadonlyMap<SoundScene, Float32Array>, rate: number, duck = true): Float32Array<ArrayBuffer> {
  const mixed = new Float32Array(Math.ceil(SEQUENCE_SECONDS * rate));
  for (let cue = 0; cue < SCENE_SEQUENCE.length; cue++) {
    const event = SCENE_SEQUENCE[cue];
    const data = samples.get(event.scene);
    if (!data) continue;
    const offset = Math.round(event.at * rate);
    const later = SCENE_SEQUENCE.slice(cue + 1).filter(other => PRIORITY[other.scene] > PRIORITY[event.scene]);
    for (let i = 0; i < data.length && i + offset < mixed.length; i++) {
      const time = (i + offset) / rate;
      let gain = SEQUENCE_GAIN;
      if (duck) for (const next of later) {
        if (time < next.at) continue;
        const progress = Math.min(1, (time - next.at) / DUCK_SECONDS);
        gain = Math.min(gain, SEQUENCE_GAIN * (1 - progress * (next.scene === 'ending' ? 0.94 : 0.75)));
      }
      mixed[i + offset] += data[i] * gain;
    }
  }
  return mixed;
}
