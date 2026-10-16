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
  return [1, 1.483, 2.137].map((ratio, i) => ({
    frequency: frequency * ratio, endFrequency: frequency * ratio * (0.42 + i * 0.025),
    wave: 'sine', gain: [0.08, 0.035, 0.02][i] * (0.94 + variation * 0.12),
    seconds: seconds / (1 + i * 0.35), delay: 0, attackSeconds: 0.01 + variation * 0.002, tailGroup: 'launch',
  }));
}
