import type { GameEvent } from '../contracts/game';
import { impactStrength } from '../effects/appearance';
import { AUDIO, chainFrequency, mergeDuration, mergeFrequency } from './tuning';

export type Tone = {
  frequency: number; endFrequency?: number; wave: OscillatorType;
  gain: number; seconds: number; delay: number;
};

export function eventTones(event: GameEvent): readonly Tone[] {
  const tier = event.sourceTier ?? 0;
  switch (event.kind) {
    case 'launch':
      return [{ frequency: 220, endFrequency: 330, wave: 'sine', gain: 0.035, seconds: 0.12, delay: 0 }];
    case 'land': {
      const power = impactStrength(event.impactSpeed ?? 0);
      return [{ frequency: 100 + power * 70, endFrequency: 55, wave: 'triangle', gain: 0.012 + power * 0.028, seconds: 0.07 + power * 0.07, delay: 0 }];
    }
    case 'merge': {
      const frequency = mergeFrequency(tier);
      const seconds = mergeDuration(tier);
      const tones: Tone[] = [
        { frequency, wave: 'triangle', gain: 0.036, seconds, delay: 0 },
        { frequency: frequency * 1.5, wave: 'triangle', gain: 0.022, seconds, delay: 0.09 },
      ];
      if ((event.chain ?? 1) > 1) tones.push({ frequency: chainFrequency(tier, event.chain!), wave: 'sine', gain: 0.018, seconds, delay: 0 });
      return tones;
    }
    case 'supernova':
      return [131, 196, 262, 330].map((frequency) => ({ frequency, wave: 'sine', gain: 0.032, seconds: 1.2, delay: AUDIO.novaSilence }));
    case 'overLimitStart':
      return [{ frequency: 95, endFrequency: 70, wave: 'sine', gain: 0.035, seconds: 0.24, delay: 0 }];
    case 'overLimitEnd':
      return [{ frequency: 300, endFrequency: 130, wave: 'sine', gain: 0.025, seconds: 0.32, delay: 0 }];
    default: return [];
  }
}
