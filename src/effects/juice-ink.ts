import type { EffectTheme } from './theme';
import type { JuiceBurst } from './juice-model';
import { burstRadius, juiceRandom, releaseProgress, visualAge } from './juice-model';
import { TIER_COLOR } from '../game/constants';

export const TURN = Math.PI * 2;
export type JuiceInk = ReturnType<typeof createJuiceInk>;
export function createJuiceInk(theme: EffectTheme) {
  // 毎フレームのぼかしとグラデーション作成を避け、色ごとの小さな光を貼る。
  const stamps = new Map<string, HTMLCanvasElement>();
  for (const color of [...TIER_COLOR, theme.text, theme.chain, '#ffbc68', '#79eaff', '#060a15', '#f7f7e8']) {
    if (stamps.has(color)) continue;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(48, 48, 0, 48, 48, 48);
    gradient.addColorStop(0, color); gradient.addColorStop(0.25, color); gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 96, 96); stamps.set(color, canvas);
  }
  return {
    theme,
    glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
      const stamp = stamps.get(color); if (stamp && radius > 0) ctx.drawImage(stamp, x - radius, y - radius, radius * 2, radius * 2);
    },
  };
}
export function arc(ctx: CanvasRenderingContext2D, radius: number, width: number, color: string, from = 0, to = TURN): void {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.arc(0, 0, Math.max(0.01, radius), from, to); ctx.stroke();
}
export function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, width: number, color: string): void {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}
export function burstValues(b: JuiceBurst) {
  const t = visualAge(b), p = releaseProgress(t), r = burstRadius(b);
  return { t, p, r, spread: r * (0.8 + 3.4 * (1 - (1 - p) ** 3)),
    color: TIER_COLOR[b.result], angle: juiceRandom(b.seed, 1) * TURN, white: '#f7f7e8' };
}
