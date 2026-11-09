import { CHAIN_MULT_MAX, LIMIT_RADIUS } from '../game/constants';
import { STRINGS } from '../ui/strings';
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
      ctx.globalAlpha = pulse(t, 0.12, 0.7); ctx.translate(-b.x - (b.chain >= 5 ? 210 : 0), -b.y - 354); ctx.font = `900 ${b.chain >= 5 ? 32 : 42 + b.chain * 4}px ${ink.theme.font}`;
      ctx.textAlign = 'center'; ctx.fillStyle = '#ffbc68'; ctx.strokeStyle = '#060a15'; ctx.lineWidth = 6;
      const label = `${b.chainCount}${STRINGS.effectChain}`;
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
      // 大きい連鎖ほど周囲の明度を一度落とし、解放の明るさとの差を作る。
      ctx.globalAlpha = pulse(t, 0.015, 0.26) * (b.chain >= 5 || b.nova ? 0.48 : 0.2);
      ctx.fillStyle = '#060a15'; ctx.beginPath(); ctx.arc(-b.x, -b.y, LIMIT_RADIUS, 0, TURN); ctx.fill(); break;
    case 29:
      ctx.translate(-b.x, -b.y);
      for (let i = 0; i < 22; i++) { const a = random(i) * TURN, d = 90 + random(i + 30) * 210, q = Math.max(0, 1 - p * 1.8); line(ctx, Math.cos(a) * d * q, Math.sin(a) * d * q, Math.cos(a) * (d * q + 14), Math.sin(a) * (d * q + 14), 1, color); } break;
    case 30: {
      const q = releaseProgress(t, 0.24, 0.46); if (t < 0.24 || q >= 1) break;
      ctx.globalAlpha = Math.sin(q * Math.PI) * 0.7;
      const distance = Math.hypot(b.x, b.y) + LIMIT_RADIUS;
      arc(ctx, r + q * distance, 18 * (1 - q) + 2, '#79eaff', angle, angle + 5.6);
      break;
    }
    case 31:
      ctx.globalAlpha = pulse(t, 0.08, 0.48) * 0.8; ctx.rotate(angle - p * 0.35); ctx.fillStyle = '#ffbc68';
      // 均等な細い王冠ではなく、間に暗い空間を残す厚い殻を割る。
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * TURN + random(i) * 0.2, width = 0.18 + random(i + 10) * 0.37;
        const d = r * (1.1 + p * (2.5 + random(i + 20))), thick = r * (0.1 + random(i + 30) * 0.22) * (1 - p);
        ctx.beginPath(); ctx.arc(0, 0, d + thick, a, a + width); ctx.arc(0, 0, d, a + width, a, true); ctx.closePath(); ctx.fill();
      }
      break;
    case 32:
      ctx.globalAlpha = pulse(t, 0.4, 0.7) * 0.65; ctx.rotate(angle); ctx.scale(1, 0.5); arc(ctx, r * (1.5 - p * 0.7), 3, color, t * 2, t * 2 + 4.7); break;
    case 33: {
      const q = releaseProgress(t, 0.18, 0.46); if (t < 0.18 || q >= 1) break;
      ctx.globalAlpha = Math.sin(q * Math.PI) * (b.chain >= 5 || b.nova ? 0.28 : 0.16);
      ctx.fillStyle = b.chain >= 5 || b.nova ? '#ffbc68' : color; ctx.rotate(Math.atan2(-b.y, -b.x) + q * 0.6);
      // 四段目は一方向の太い扇。最大段では盤面を横断する膜へ広がる。
      const reach = b.chain >= 5 || b.nova ? LIMIT_RADIUS * 2 : LIMIT_RADIUS * 1.25;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, reach * Math.sin(q * Math.PI / 2), -0.75, 0.75); ctx.closePath(); ctx.fill();
      break;
    }
    case 34:
      ctx.translate(-b.x, -b.y);
      for (const body of b.neighbors) {
        const arrival = 0.2 + Math.hypot(body.x - b.x, body.y - b.y) / 1100;
        const strength = pulse(t, arrival, 0.26); if (!strength) continue;
        ctx.save(); ctx.translate(body.x, body.y); ctx.globalAlpha = strength * 0.8;
        const facing = Math.atan2(b.y - body.y, b.x - body.x);
        arc(ctx, body.radius + 1, 3 + strength * 3, '#ffbc68', facing - 0.6, facing + 0.6);
        ctx.globalAlpha = strength * 0.18; ink.glow(ctx, 0, 0, body.radius * 1.6, color); ctx.restore();
      }
      break;
    case 35:
      ctx.globalAlpha = pulse(t, 0.07, 0.22); ctx.strokeStyle = white; ctx.lineWidth = 2;
      for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.moveTo(0, 0); const a = angle + j * 2.2; for (let i = 1; i <= 5; i++) { const d = i * spread / 4, offset = (random(i + j * 8) - 0.5) * r; ctx.lineTo(Math.cos(a) * d - Math.sin(a) * offset, Math.sin(a) * d + Math.cos(a) * offset); } ctx.stroke(); } break;
    case 36:
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = pulse(t, 0.06, 0.16) * 0.85;
      ctx.rotate(Math.atan2(-b.y, -b.x) + Math.PI / 2); ctx.scale(0.16 + p * 0.2, 3.5); ink.glow(ctx, 0, 0, spread, white); break;
    case 37:
      for (let i = 0; i < 9; i++) { const a = random(i) * TURN; ctx.globalAlpha = pulse(t, 0.13 + random(i + 10) * 0.2, 0.12) * 0.9; ink.glow(ctx, Math.cos(a) * spread, Math.sin(a) * spread, 8 + random(i + 20) * 16, '#ffbc68'); } break;
    case 38: {
      const q = releaseProgress(t, 0.3, 0.38); if (t < 0.3 || q >= 1) break;
      ctx.translate(-b.x, -b.y); ctx.globalAlpha = Math.sin(q * Math.PI) * 0.75;
      // 最大段の波が外周へ達した後だけ、太い反射が周回する。
      for (let i = 0; i < 6; i++) {
        const a = angle + i * 1.03 + q * 0.4;
        arc(ctx, LIMIT_RADIUS - 65 - Math.sin(i + q * 3) * 10, 18 * (1 - q) + 3, '#ffbc68', a, a + 0.44);
      }
      break;
    }
    case 39:
      ctx.globalAlpha = pulse(t, 0.06, 0.19); arc(ctx, r * (0.8 + p), 8, '#060a15'); arc(ctx, r * (0.83 + p), 2, white); break;
    case 40: {
      const q = releaseProgress(t, 0.2, 0.8); if (t < 0.2 || q >= 1) break;
      ctx.globalAlpha = (1 - q) * 0.9; ctx.translate(-b.x + 30, -b.y - 350); ctx.rotate(-0.04 + Math.sin(q * 20) * 0.015 * (1 - q)); ctx.font = `900 ${72 + Math.sin(q * Math.PI) * 12}px ${ink.theme.font}`; ctx.textAlign = 'center'; ctx.lineWidth = 8; ctx.strokeStyle = '#060a15'; ctx.fillStyle = '#ffbc68'; ctx.strokeText(`×${CHAIN_MULT_MAX.toFixed(1)}`, 0, 0); ctx.fillText(`×${CHAIN_MULT_MAX.toFixed(1)}`, 0, 0); break;
    }
    case 41:
      ctx.globalAlpha = pulse(t, 0.17, 0.45) * 0.3; ctx.fillStyle = '#79eaff';
      for (let i = 0; i < 3; i++) {
        const offset = (i - 1) * 45, width = 10 + random(i) * 18;
        ctx.beginPath(); ctx.moveTo(-b.x, -b.y); ctx.quadraticCurveTo(-b.x * 0.5 + offset, -b.y * 0.5 - spread * 0.3, r * 0.5, 0);
        ctx.quadraticCurveTo(-b.x * 0.5 + offset + width, -b.y * 0.5 - spread * 0.3, -b.x, -b.y); ctx.fill();
      }
      break;
    case 42:
      ctx.globalAlpha = pulse(t, 0.55, 0.6) * 0.75;
      for (let i = 0; i < 12; i++) { const a = random(i) * TURN, d = r * (5 - releaseProgress(t, 0.55, 0.65) * 4); line(ctx, Math.cos(a) * d, Math.sin(a) * d, Math.cos(a - 0.07) * (d + 15), Math.sin(a - 0.07) * (d + 15), 1.5, color); } break;
  }
}
