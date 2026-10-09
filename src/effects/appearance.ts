import { BOARD_SIZE, SPEED_MAX, TIER_RADIUS } from '../game/constants';
import type { Tier } from '../contracts/game';

// ユーザーの「今の 5 倍派手に」に合わせ、基準の粒子数を 5 倍にする。
export const PARTICLE_BOOST = 5;
export const VISUAL = {
  launchSeconds: 0.18, launchSpread: 30,
  shrinkSeconds: 0.08, novaShrinkSeconds: 0.1, flashSeconds: 0.18,
  textSize: 26, chainTextSize: 34, novaTextSize: 36, textGap: 38,
  warningSeconds: 0.85, recoverySeconds: 0.5,
  particleSize: 2.5, particleSizeSpread: 3.5, tailSeconds: 0.045,
  outlineWidth: 5, turn: Math.PI * 2,
};

export function mergeProfile(tier: Tier, chain: number, nova = false) {
  const extra = Math.min(4, Math.max(0, chain - 1));
  return {
    particles: nova ? 240 : PARTICLE_BOOST * (8 + 2 * tier) + extra * 10,
    radius: nova ? BOARD_SIZE * 0.56 : TIER_RADIUS[tier] * (3.2 + extra * 0.2),
    rings: nova ? 4 : 2 + Math.min(2, extra),
    width: nova ? 10 : 4 + tier * 0.7 + extra * 0.5,
    speed: nova ? 1100 : 400 + tier * 60 + extra * 30,
    seconds: nova ? 0.85 : 0.35 + tier * 0.04 + extra * 0.03,
    particleSeconds: nova ? 1 : 0.45 + tier * 0.04,
  };
}

export function impactStrength(speed: number): number {
  return Math.min(1, Math.max(0, speed / SPEED_MAX));
}

export function signedNumber(value: number): string {
  return `${value < 0 ? '−' : '＋'}${Math.abs(value).toLocaleString('ja-JP')}`;
}

// TODO(依頼中): 担当 D の strings へ移す。
export const EFFECT_TEXT = { chain: '連鎖', nova: '超新星反応', heat: '核熱量' };
