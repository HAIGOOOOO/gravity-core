import { VISUAL } from './appearance';
import { fade, floatOffset, lifeProgress, ringRadius } from './motion';
import type { EffectPool } from './pool';
import type { EffectTheme } from './theme';

export function drawPool(ctx: CanvasRenderingContext2D, pool: EffectPool, theme: EffectTheme): void {
  ctx.lineCap = 'round';
  for (const ring of pool.rings) {
    if (!ring.active) continue;
    const opacity = fade(ring.age, ring.lifetime);
    const radius = ring.stationary ? ring.endRadius
      : ringRadius(ring.startRadius, ring.endRadius, lifeProgress(ring.age, ring.lifetime));
    ctx.strokeStyle = ring.color;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, radius, 0, VISUAL.turn);
    ctx.lineWidth = ring.width * 3;
    ctx.globalAlpha = opacity * 0.15;
    ctx.stroke();
    ctx.lineWidth = ring.width;
    ctx.globalAlpha = opacity;
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const particle of pool.particles) {
    if (!particle.active) continue;
    ctx.globalAlpha = fade(particle.age, particle.lifetime);
    ctx.strokeStyle = particle.color;
    ctx.lineWidth = particle.size;
    ctx.beginPath();
    ctx.moveTo(particle.x - particle.vx * VISUAL.tailSeconds, particle.y - particle.vy * VISUAL.tailSeconds);
    ctx.lineTo(particle.x, particle.y);
    ctx.stroke();
    ctx.fillStyle = theme.text;
    ctx.fillRect(particle.x - 1, particle.y - 1, 2, 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = VISUAL.outlineWidth;
  ctx.strokeStyle = theme.bg;
  for (const text of pool.texts) {
    if (!text.active) continue;
    ctx.globalAlpha = 1 - lifeProgress(text.age, text.lifetime);
    ctx.font = `700 ${text.size}px ${theme.font}`;
    const y = text.y + floatOffset(text.age);
    ctx.fillStyle = text.color;
    ctx.strokeText(text.text, text.x, y);
    ctx.fillText(text.text, text.x, y);
  }
}
