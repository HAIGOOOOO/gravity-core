import type { GameEvent } from '../contracts/game';
import { impactStrength } from '../effects/appearance';
import { AUDIO, chainFrequency, mergeDuration, mergeFrequency } from './tuning';
import { launchTones } from './launch';
import { releaseTime } from '../effects/juice-model';

export type Tone = {
  frequency: number; endFrequency?: number; wave: OscillatorType | 'noise';
  gain: number; seconds: number; delay: number;
  attackSeconds?: number;
  tailGroup?: 'launch';
  pan?: number;
};

export function eventTones(event: GameEvent): readonly Tone[] {
  const tier = event.sourceTier ?? 0;
  switch (event.kind) {
    case 'launch':
      return launchTones(tier, event.sequence);
    case 'land': {
      const power = impactStrength(event.impactSpeed ?? 0);
      return [
        { frequency: 150 + power * 120, endFrequency: 48, wave: 'triangle', gain: 0.06 + power * 0.14, seconds: 0.1 + power * 0.12, delay: 0 },
        { frequency: 1800, endFrequency: 250, wave: 'noise', gain: 0.08 + power * 0.2, seconds: 0.08 + power * 0.1, delay: 0, attackSeconds: 0.003 },
        { frequency: 1000, endFrequency: 400, wave: 'sine', gain: 0.025 + power * 0.04, seconds: 0.06, delay: 0.008 },
      ];
    }
    case 'merge': {
      const frequency = mergeFrequency(tier);
      const seconds = mergeDuration(tier);
      const chain = event.chain ?? 1;
      const at = releaseTime({ tier, chain, nova: false });
      const tones: Tone[] = [
        { frequency: frequency * 0.65, endFrequency: frequency * 1.1, wave: 'sine', gain: 0.1, seconds: at, delay: 0 },
        { frequency: 110 / (1 + tier * 0.06), endFrequency: 38, wave: 'sine', gain: 0.32, seconds: 0.34 + tier * 0.04, delay: at, attackSeconds: 0.004 },
        { frequency: 2600, endFrequency: 180, wave: 'noise', gain: 0.42, seconds: 0.26 + tier * 0.025, delay: at, attackSeconds: 0.003 },
        { frequency, endFrequency: frequency * 0.98, wave: 'triangle', gain: 0.2, seconds: seconds + 0.15, delay: at },
        { frequency: frequency * 1.5, wave: 'sine', gain: 0.1, seconds: seconds + 0.3, delay: at + 0.07, pan: -0.35 },
        { frequency: frequency * 5, endFrequency: frequency * 2, wave: 'sine', gain: 0.07, seconds: 0.065, delay: at, attackSeconds: 0.003, pan: 0.35 },
      ];
      if (chain > 1) tones.push({ frequency: chainFrequency(tier, chain), wave: 'sine', gain: 0.11, seconds: 0.4, delay: at + 0.035, pan: 0.4 });
      if (chain >= 5) for (const [i, ratio] of [2, 3].entries()) tones.push({ frequency: frequency * ratio, wave: 'triangle', gain: 0.075, seconds: 0.45, delay: at + 0.12 + i * 0.07, pan: i ? 0.55 : -0.55 });
      return tones;
    }
    case 'supernova':
      return [
        { frequency: 80, endFrequency: 27, wave: 'sine', gain: 0.48, seconds: 1.4, delay: 0.18, attackSeconds: 0.008 },
        { frequency: 1900, endFrequency: 100, wave: 'noise', gain: 0.58, seconds: 1.1, delay: 0.18, attackSeconds: 0.004 },
        { frequency: 131, endFrequency: 65, wave: 'triangle', gain: 0.22, seconds: 0.8, delay: 0.18 },
        ...[262, 330, 392, 523, 784].map((frequency, i): Tone => ({ frequency, wave: 'sine', gain: 0.1, seconds: 1.2 - i * 0.1, delay: AUDIO.novaSilence + 0.06 + i * 0.045, pan: i % 2 ? 0.6 : -0.6 })),
      ];
    case 'overLimitStart':
      return [0, 0.16].map(delay => ({ frequency: 660, endFrequency: 440, wave: 'triangle', gain: 0.2, seconds: 0.14, delay }));
    case 'overLimitEnd':
      return [392, 587].map((frequency, i) => ({ frequency, wave: 'sine', gain: 0.12, seconds: 0.4, delay: i * 0.07, pan: i ? 0.3 : -0.3 }));
    case 'gameOver':
      return [262, 196, 131].map((frequency, i) => ({ frequency, endFrequency: frequency * 0.9, wave: 'triangle', gain: 0.13, seconds: 0.6, delay: i * 0.12 }));
    default: return [];
  }
}
