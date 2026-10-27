import type { Tier } from '../contracts/game';
import { TIER_RADIUS } from '../game/constants';
import type { Tone } from './tones';
import { soundVariation } from './variation';

/** 同じ出来事の再生は再現でき、連投では音高と余韻がわずかに変わる。 */
export function launchTones(tier: Tier, sequence: number): readonly Tone[] {
  const variation = soundVariation(sequence);
  const scale = (TIER_RADIUS[0] / TIER_RADIUS[tier]) ** 0.32;
  const frequency = 720 * scale * (0.98 + variation * 0.04);
  const seconds = (0.16 + tier * 0.008) * (0.96 + variation * 0.08);
  const tones: Tone[] = [1, 1.483, 2.137].map((ratio, i) => ({
    frequency: frequency * ratio, endFrequency: frequency * ratio * (0.42 + i * 0.025),
    wave: 'sine', gain: [0.22, 0.09, 0.05][i] * (0.94 + variation * 0.12),
    seconds: seconds / (1 + i * 0.35), delay: 0, attackSeconds: 0.01 + variation * 0.002, tailGroup: 'launch',
  }));
  tones.push(
    { frequency: 180 * scale, endFrequency: 45 * scale, wave: 'triangle', gain: 0.16, seconds: 0.18, delay: 0, attackSeconds: 0.006, tailGroup: 'launch' },
    { frequency: 1800, endFrequency: 300, wave: 'noise', gain: 0.28, seconds: 0.12, delay: 0, attackSeconds: 0.005, tailGroup: 'launch', pan: -0.15 },
    { frequency: 1300, endFrequency: 400, wave: 'sine', gain: 0.05, seconds: 0.08, delay: 0, attackSeconds: 0.005, tailGroup: 'launch', pan: 0.15 },
  );
  return tones;
}
