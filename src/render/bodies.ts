// 物理と同じ円形を保ち、色を見分けなくても階級を探せる模様を重ねる。

import type { DrawBodyOptions } from '../contracts/app';
import type { Tier } from '../contracts/game';
import { TIER_COLOR } from '../game/constants';

const INK = '#182139', LIGHT = '#f7f7e8';
function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

function motif(ctx: CanvasRenderingContext2D, tier: Tier): void {
  ctx.fillStyle = INK; ctx.strokeStyle = LIGHT; ctx.lineWidth = 0.07; ctx.lineCap = 'round';
  switch (tier) {
    case 0:
      ctx.fillStyle = LIGHT; disc(ctx, 0, 0, 0.2);
      ctx.beginPath(); ctx.arc(0, 0, 0.58, 0, Math.PI * 2); ctx.stroke(); break;
    case 1:
      disc(ctx, -0.25, -0.2, 0.26); disc(ctx, 0.35, 0.26, 0.18); disc(ctx, -0.1, 0.46, 0.1); break;
    case 2:
      ctx.beginPath(); ctx.moveTo(-0.54, 0.25); ctx.lineTo(-0.35, -0.46); ctx.lineTo(0.32, -0.57);
      ctx.lineTo(0.57, 0.17); ctx.lineTo(0.06, 0.6); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-0.35, -0.46); ctx.lineTo(0.06, 0.1); ctx.lineTo(0.57, 0.17); ctx.stroke(); break;
    case 3:
      ctx.fillStyle = LIGHT; disc(ctx, 0, 0, 0.67); ctx.fillStyle = TIER_COLOR[tier]; disc(ctx, 0.3, -0.12, 0.63);
      ctx.fillStyle = INK; disc(ctx, -0.42, 0.17, 0.13); break;
    case 4:
      ctx.rotate(-0.32); ctx.fillRect(-1, -0.17, 2, 0.34);
      ctx.beginPath(); ctx.moveTo(-0.85, -0.23); ctx.lineTo(0.85, -0.23); ctx.stroke(); break;
    case 5:
      for (const y of [-0.48, 0, 0.48]) ctx.fillRect(-1, y - 0.08, 2, 0.16);
      ctx.beginPath(); ctx.moveTo(-0.8, 0.2); ctx.lineTo(0.8, 0.2); ctx.stroke(); break;
    case 6:
      ctx.strokeStyle = INK; ctx.lineWidth = 0.13;
      for (const y of [-0.46, 0, 0.46]) { ctx.beginPath(); ctx.moveTo(-1, y); ctx.bezierCurveTo(-0.4, y - 0.24, 0.4, y + 0.24, 1, y); ctx.stroke(); }
      ctx.strokeStyle = LIGHT; ctx.lineWidth = 0.06; ctx.beginPath(); ctx.ellipse(0.28, 0.17, 0.27, 0.16, -0.15, 0, Math.PI * 2); ctx.stroke(); break;
    case 7:
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * 0.45, Math.sin(a) * 0.45); ctx.lineTo(Math.cos(a) * 0.8, Math.sin(a) * 0.8); ctx.stroke(); }
      ctx.fillStyle = LIGHT; disc(ctx, 0, 0, 0.3); break;
    case 8:
      ctx.fillStyle = LIGHT; ctx.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.3 : 0.73;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.arc(0, 0, 0.88, 0, Math.PI * 2); ctx.stroke(); break;
  }
}

/**
 * 天体を 1 個描く。座標と半径は、呼び出し側の ctx の座標系のまま使う
 * （盤面では論理座標、HUD の「次の天体」では CSS px）。
 */
export function drawBody(
  ctx: CanvasRenderingContext2D,
  tier: Tier,
  x: number,
  y: number,
  radius: number,
  options: DrawBodyOptions = {},
): void {
  ctx.save();
  ctx.globalAlpha *= options.alpha ?? 1;
  ctx.translate(x, y); ctx.scale(radius, radius);
  ctx.fillStyle = TIER_COLOR[tier];
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.clip();
  motif(ctx, tier);
  ctx.restore();
}
