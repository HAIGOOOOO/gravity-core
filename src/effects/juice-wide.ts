import { CHAIN_MULT_MAX, CHAIN_STEP, LIMIT_RADIUS } from '../game/constants';
import { arc, burstValues, line, TURN, type JuiceInk } from './juice-ink';
import { juiceRandom, pulse, releaseProgress, type JuiceBurst } from './juice-model';

export function drawWideLayer(id: number, ctx: CanvasRenderingContext2D, b: JuiceBurst, ink: JuiceInk): void {
  const { t, p, r, spread, color, angle, white } = burstValues(b);
  const random = (i: number) => juiceRandom(b.seed + id * 43, i);
  ctx.globalAlpha = (1 - p) * 0.7; ctx.lineCap = 'round';
  switch (id) {
    case 23:
      ctx.globalAlpha = pulse(t, 0.03, 0.45) * 0.8; ctx.strokeStyle = '#79eaff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(b.px - b.x, b.py - b.y); ctx.quadraticCurveTo(-b.x * 0.35, -b.y * 0.35, 0, 0); ctx.stroke(); break;
    case 24: {
      ctx.globalAlpha = pulse(t, 0.12, 0.7); ctx.translate(b.chain >= 5 ? -r * 1.5 : 0, r + 55); ctx.font = `900 ${b.chain >= 5 ? 32 : 42 + b.chain * 4}px ${ink.theme.font}`;
      ctx.textAlign = 'center'; ctx.fillStyle = '#ffbc68'; ctx.strokeStyle = '#060a15'; ctx.lineWidth = 6;
      const label = b.chain >= 5 ? `${b.chain}連鎖` : `×${Math.min(CHAIN_MULT_MAX, 1 + (b.chain - 1) * CHAIN_STEP).toFixed(1)}`;
      const offset = Math.max(0, 1 - (t - 0.12) / 0.12) * 18; ctx.save(); ctx.beginPath(); ctx.rect(-200, -100, 400, 90); ctx.clip(); ctx.strokeText(label, -offset, 0); ctx.fillText(label, -offset, 0); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(-200, -10, 400, 90); ctx.clip(); ctx.strokeText(label, offset, 0); ctx.fillText(label, offset, 0); ctx.restore(); break;
    }
    case 25:
      for (let i = 0; i < 7; i++) { const q = (p * 2 + i / 7) % 1; ink.glow(ctx, (b.px - b.x) * (1 - q), (b.py - b.y) * (1 - q) - Math.sin(q * Math.PI) * 15, 4 + i % 3, '#79eaff'); } break;
    case 26:
      ctx.globalAlpha = pulse(t, 0.08, 0.22) * 0.5; ctx.save(); ctx.translate(5 + p * 10, -3); arc(ctx, spread * 0.72, 6, '#79eaff', angle, angle + 4.8); ctx.restore(); ctx.translate(-5, 3); arc(ctx, spread * 0.72, 4, '#ffbc68', angle, angle + 4.8); break;
    case 27:
      ctx.globalAlpha = pulse(t, 0.03, 0.5) * 0.45; ctx.rotate(angle); ctx.strokeStyle = color; ctx.lineWidth = 1;
      for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(-spread, i * 16); ctx.quadraticCurveTo(0, i * 5 - 28 * (1 - p), spread, i * 16); ctx.stroke(); } break;
    case 28:
      ctx.globalAlpha = pulse(t, 0.015, 0.45) * 0.23; ink.glow(ctx, 0, 0, spread * 2, '#060a15'); break;
    case 29:
      ctx.translate(-b.x, -b.y);
      for (let i = 0; i < 22; i++) { const a = random(i) * TURN, d = 90 + random(i + 30) * 210, q = Math.max(0, 1 - p * 1.8); line(ctx, Math.cos(a) * d * q, Math.sin(a) * d * q, Math.cos(a) * (d * q + 14), Math.sin(a) * (d * q + 14), 1, color); } break;
    case 30:
      ctx.translate(-b.x, -b.y); ctx.globalAlpha = pulse(t, 0.12, 0.65) * 0.7;
      for (let i = 0; i < 8; i++) { const a = angle + i * 0.7, d = LIMIT_RADIUS - 25 - Math.sin(i + t * 15) * 5; arc(ctx, d, 2, '#79eaff', a, a + 0.15); } break;
    case 31:
      ctx.globalAlpha = pulse(t, 0.08, 0.48) * 0.7; ctx.rotate(angle - p); ctx.fillStyle = '#ffbc68';
      for (let i = 0; i < 9; i++) { const a = i / 9 * TURN, d = spread * 0.9; ctx.beginPath(); ctx.moveTo(Math.cos(a) * d, Math.sin(a) * d); ctx.lineTo(Math.cos(a + 0.04) * (d + r * 0.3), Math.sin(a + 0.04) * (d + r * 0.3)); ctx.lineTo(Math.cos(a + 0.1) * d, Math.sin(a + 0.1) * d); ctx.fill(); } break;
    case 32:
      ctx.globalAlpha = pulse(t, 0.4, 0.7) * 0.65; ctx.rotate(angle); ctx.scale(1, 0.5); arc(ctx, r * (1.5 - p * 0.7), 3, color, t * 2, t * 2 + 4.7); break;
    case 33:
      ctx.globalAlpha = pulse(t, 0.1, 0.6) * 0.17; ctx.fillStyle = color; ctx.rotate(angle + p * 2);
      for (let i = 0; i < 4; i++) { ctx.rotate(1.63); ctx.beginPath(); ctx.moveTo(r * 0.3, 0); ctx.lineTo(spread * 1.7, -spread * 0.35); ctx.lineTo(spread * 1.6, spread * 0.12); ctx.fill(); } break;
    case 34:
      ctx.translate(-b.x, -b.y); ctx.globalAlpha = pulse(t, 0.16, 0.7) * 0.2;
      for (let i = 0; i < 3; i++) { ctx.save(); ctx.scale(1, 0.8); arc(ctx, 90 + i * 45 + p * 80, 1.5, color, angle, angle + 4.2); ctx.restore(); } break;
    case 35:
      ctx.globalAlpha = pulse(t, 0.07, 0.22); ctx.strokeStyle = white; ctx.lineWidth = 2;
      for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.moveTo(0, 0); const a = angle + j * 2.2; for (let i = 1; i <= 5; i++) { const d = i * spread / 4, offset = (random(i + j * 8) - 0.5) * r; ctx.lineTo(Math.cos(a) * d - Math.sin(a) * offset, Math.sin(a) * d + Math.cos(a) * offset); } ctx.stroke(); } break;
    case 36:
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = pulse(t, 0.06, 0.16) * 0.85;
      ctx.rotate(Math.atan2(-b.y, -b.x) + Math.PI / 2); ctx.scale(0.16 + p * 0.2, 3.5); ink.glow(ctx, 0, 0, spread, white); break;
    case 37:
      for (let i = 0; i < 9; i++) { const a = random(i) * TURN; ctx.globalAlpha = pulse(t, 0.13 + random(i + 10) * 0.2, 0.12) * 0.9; ink.glow(ctx, Math.cos(a) * spread, Math.sin(a) * spread, 8 + random(i + 20) * 16, '#ffbc68'); } break;
    case 38:
      ctx.translate(-b.x, -b.y); ctx.globalAlpha = pulse(t, 0.11, 0.42) * 0.5;
      for (let i = 0; i < 4; i++) { const a = angle + i * 1.6; ctx.save(); ctx.translate(Math.cos(a) * 290, Math.sin(a) * 290); ctx.rotate(a); line(ctx, -10, -30, 0, 30, 6, color); ctx.restore(); } break;
    case 39:
      ctx.globalAlpha = pulse(t, 0.06, 0.19); arc(ctx, r * (0.8 + p), 8, '#060a15'); arc(ctx, r * (0.83 + p), 2, white); break;
    case 40: {
      const q = releaseProgress(t, 0.2, 0.8); if (t < 0.2 || q >= 1) break;
      ctx.globalAlpha = (1 - q) * 0.9; ctx.translate(-b.x * 0.3, 110 - b.y * 0.3); ctx.rotate(-0.06 + Math.sin(q * 20) * 0.015 * (1 - q)); ctx.font = `900 ${90 + Math.sin(q * Math.PI) * 18}px ${ink.theme.font}`; ctx.textAlign = 'center'; ctx.lineWidth = 8; ctx.strokeStyle = '#060a15'; ctx.fillStyle = '#ffbc68'; ctx.strokeText(`×${CHAIN_MULT_MAX.toFixed(1)}`, 0, 0); ctx.fillText(`×${CHAIN_MULT_MAX.toFixed(1)}`, 0, 0); break;
    }
    case 41:
      ctx.globalAlpha = pulse(t, 0.04, 0.65) * 0.45; ctx.strokeStyle = '#79eaff'; ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) { const a = random(i) * TURN; ctx.beginPath(); ctx.moveTo(-b.x, -b.y); ctx.quadraticCurveTo(-b.x * 0.5 + Math.cos(a) * spread, -b.y * 0.5 + Math.sin(a) * spread, Math.cos(a) * r, Math.sin(a) * r); ctx.stroke(); } break;
    case 42:
      ctx.globalAlpha = pulse(t, 0.55, 0.6) * 0.75;
      for (let i = 0; i < 12; i++) { const a = random(i) * TURN, d = r * (5 - releaseProgress(t, 0.55, 0.65) * 4); line(ctx, Math.cos(a) * d, Math.sin(a) * d, Math.cos(a - 0.07) * (d + 15), Math.sin(a - 0.07) * (d + 15), 1.5, color); } break;
  }
}
