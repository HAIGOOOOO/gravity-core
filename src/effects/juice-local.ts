import { drawBody } from '../render/bodies';
import { TIER_RADIUS } from '../game/constants';
import { signedNumber } from './appearance';
import { arc, burstValues, line, TURN, type JuiceInk } from './juice-ink';
import { juiceRandom, pulse, releaseProgress, type JuiceBurst } from './juice-model';

export function drawLocalLayer(id: number, ctx: CanvasRenderingContext2D, b: JuiceBurst, ink: JuiceInk): void {
  const { t, p, r, spread, color, angle, white } = burstValues(b);
  const random = (i: number) => juiceRandom(b.seed + id * 101, i);
  const fade = (1 - p) ** 1.5;
  ctx.globalAlpha = fade; ctx.lineCap = 'round';
  switch (id) {
    case 1:
      if (t > 0.11) break;
      for (const side of [-1, 1]) { ctx.globalAlpha = 1 - t / 0.11; drawBody(ctx, b.tier, side * r * (1 - t / 0.11), side * r * 0.2, TIER_RADIUS[b.tier] * (1 - t / 0.14)); }
      break;
    case 2:
      ctx.globalAlpha = pulse(t, 0, 0.19);
      for (let i = 0; i < 16; i++) { const a = random(i) * TURN, d = r * (3 - Math.min(1, t / 0.12) * 2.5); line(ctx, Math.cos(a) * d, Math.sin(a) * d, Math.cos(a) * (d + r * 0.5), Math.sin(a) * (d + r * 0.5), 1.5, color); }
      break;
    case 3:
      ctx.globalAlpha = pulse(t, 0, 0.22) * 0.3;
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(0, 0, r * (0.7 + i * 0.24), r * (0.15 + t), angle + i * 0.32, 0, TURN); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke(); }
      break;
    case 4:
      ctx.globalAlpha = pulse(t, 0, 0.23); ctx.fillStyle = '#060a15'; ctx.beginPath(); ctx.arc(0, 0, r * 0.75, 0, TURN); ctx.fill(); break;
    case 5:
      ctx.globalAlpha = pulse(t, 0.035, 0.16);
      for (let i = 0; i < 5; i++) { const a = angle + i * 1.19; ctx.strokeStyle = white; ctx.lineWidth = 1.7; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.4); ctx.lineTo(Math.cos(a + 0.35) * r * 0.65, Math.sin(a + 0.35) * r * 0.65); ctx.stroke(); } break;
    case 6: ctx.globalAlpha = pulse(t, 0.055, 0.14); arc(ctx, r * (0.6 + p), 5 * (1 - p), white); break;
    case 7:
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = pulse(t, 0.07, 0.32) * 0.8;
      ink.glow(ctx, 0, 0, r * (3.6 + b.chain * 0.3), color);
      ctx.globalAlpha = pulse(t, 0.07, 0.10) * 0.9; ink.glow(ctx, 0, 0, r * 1.5, white);
      ctx.rotate(angle); ctx.scale(2.7, 0.28); ink.glow(ctx, 0, 0, spread * 1.6, white); break;
    case 8: if (t > 0.07) arc(ctx, spread, 8 * fade + 0.3, white, angle, angle + 5.1); break;
    case 9:
      ctx.globalAlpha = pulse(t, 0.09, 0.42) * 0.55; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i <= 30; i++) { const a = i / 30 * TURN, d = spread * (0.9 + 0.12 * Math.sin(a * 5 + angle)); ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d); } ctx.stroke(); break;
    case 10:
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = pulse(t, 0.075, 0.36);
      for (let i = 0; i < 7; i++) { ctx.save(); ctx.rotate(random(i) * TURN); ctx.fillStyle = i % 2 ? white : color; ctx.beginPath(); ctx.moveTo(r * 0.4, -5); ctx.lineTo(spread * (1.3 + random(i + 8)), 0); ctx.lineTo(r, 7); ctx.fill(); ctx.restore(); } break;
    case 11:
      if (t < 0.07) break;
      for (let i = 0; i < 18; i++) { const a = random(i) * TURN, d = spread * (0.35 + random(i + 30) * 0.9), s = 3 + random(i + 60) * 10;
        ctx.save(); ctx.translate(Math.cos(a) * d, Math.sin(a) * d); ctx.rotate(a + p * 9); ctx.fillStyle = i % 3 ? color : white; ctx.beginPath(); ctx.moveTo(-s, -s * 0.3); ctx.lineTo(s * 0.7, -s * 0.6); ctx.lineTo(s * 0.2, s * 0.8); ctx.closePath(); ctx.fill(); ctx.restore(); } break;
    case 12:
      if (t < 0.07) break;
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 34; i++) { const a = random(i) * TURN, d = spread * (0.6 + random(i + 40)); const x = Math.cos(a) * d, y = Math.sin(a) * d; ctx.strokeStyle = i % 3 ? '#ffbc68' : white; ctx.lineWidth = 1 + random(i + 10) * 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x * 0.88 - b.x * p * 0.04, y * 0.88 - b.y * p * 0.04, x * 0.77, y * 0.77); ctx.stroke(); } break;
    case 13:
      ctx.globalCompositeOperation = 'lighter';
      ctx.rotate(angle + p * 2); ctx.globalAlpha *= 0.75;
      for (let i = 0; i < 3; i++) { ctx.save(); ctx.rotate(i * 2.1); ctx.strokeStyle = color; ctx.lineWidth = 3 - i * 0.6; ctx.beginPath(); ctx.moveTo(r, 0); ctx.bezierCurveTo(spread, -r, spread * 0.3, r * 2, -r * 0.4, spread * 0.5); ctx.stroke(); ctx.restore(); } break;
    case 14:
      ctx.globalAlpha = pulse(t, 0.15, 0.9) * 0.35;
      for (let i = 0; i < 6; i++) { const a = random(i) * TURN; ink.glow(ctx, Math.cos(a) * spread * 0.45, Math.sin(a) * spread * 0.45, r * (0.6 + p), '#060a15'); } break;
    case 15:
      ctx.globalAlpha = pulse(t, 0.18, 0.8) * 0.5; ctx.rotate(angle + p); ctx.scale(1, 0.38); arc(ctx, spread * 0.8, 2, color, p * 4, p * 4 + 3.5); break;
    case 16:
      ctx.globalAlpha = pulse(t, 0.08, 0.32) * 0.35;
      for (const side of [-1, 1]) { ctx.save(); ctx.translate(side * r * (0.9 + p), side * r * 0.2); arc(ctx, TIER_RADIUS[b.tier] * (1 - p), 1.5, color); ctx.restore(); } break;
    case 17:
      if (t < 0.08 || t > 0.42) break;
      ctx.globalAlpha = 1; ctx.scale(1 + Math.sin((t - 0.08) * 23) * 0.13 * (1 - p), 1 - Math.sin((t - 0.08) * 23) * 0.08 * (1 - p));
      if (b.nova) { ctx.fillStyle = '#060a15'; ctx.beginPath(); ctx.arc(0, 0, r * (0.6 + p), 0, TURN); ctx.fill(); }
      else drawBody(ctx, b.result, 0, 0, TIER_RADIUS[b.result], { seed: b.seed }); break;
    case 18:
      ctx.globalAlpha = pulse(t, 0.18, 0.46) * 0.7; ctx.rotate(angle + Math.sin(t * 22) * 0.15); arc(ctx, r * 0.7, 1.5, white, 0.3, 1.6); arc(ctx, r * 0.55, 1, color, 2.8, 4.7); break;
    case 19: {
      const q = releaseProgress(t, 0.10, 0.22); if (t < 0.1 || q >= 1) break;
      ctx.translate(0, -r - 20 - q * 15); ctx.scale(0.65 + Math.sin(q * Math.PI) * 0.6, 1.4 - q * 0.4); ctx.font = `900 ${30 + b.chain * 4}px ${ink.theme.font}`; ctx.textAlign = 'center'; ctx.lineWidth = 5; ctx.strokeStyle = '#060a15'; ctx.fillStyle = white; ctx.strokeText(signedNumber(b.score), 0, 0); ctx.fillText(signedNumber(b.score), 0, 0); break;
    }
    case 20: {
      const q = releaseProgress(t, 0.32, 0.65); if (t < 0.32 || q >= 1) break;
      const x = (360 - b.x) * q * q, y = (-400 - b.y) * q - Math.sin(q * Math.PI) * 80;
      line(ctx, x - q * 24, y + 10, x, y, 3, color); ctx.translate(x, y); ctx.scale(1 - q * 0.55, 1 - q * 0.55); ctx.globalAlpha = 1 - q * q; ctx.font = `900 ${30 + b.chain * 4}px ${ink.theme.font}`; ctx.textAlign = 'center'; ctx.fillStyle = white; ctx.strokeStyle = '#060a15'; ctx.lineWidth = 4; ctx.strokeText(signedNumber(b.score), 0, 0); ctx.fillText(signedNumber(b.score), 0, 0); break;
    }
    case 21:
      ctx.globalAlpha = pulse(t, 0.94, 0.3) * 0.65; ink.glow(ctx, 360 - b.x, -400 - b.y, r * 1.1, color); break;
    case 22:
      ctx.translate(-b.x, -b.y); ctx.globalAlpha = pulse(t, 0.13, 0.5) * 0.5; arc(ctx, 53 + p * 12, 3, color, angle - 0.4, angle + 0.8); break;
  }
}
