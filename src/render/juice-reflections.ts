import type { BodyView } from '../contracts/game';
import { juiceEnvelope, type JuiceBurst } from './juice-model';

export function drawJuiceMemories(ctx: CanvasRenderingContext2D, burst: JuiceBurst, sources: readonly BodyView[], time: number): void {
  if (burst.chain < 2 && !burst.supernova) return;
  const opacity = juiceEnvelope(time, .09, .12, .42);
  ctx.save(); ctx.globalAlpha *= opacity; ctx.strokeStyle = '#fff2d8'; ctx.lineWidth = 4;
  for (const body of sources) {
    const facing = Math.atan2(body.y - burst.y, body.x - burst.x);
    ctx.beginPath(); ctx.arc(body.x, body.y, body.radius + time * 35, facing - 1.1, facing + 1.1); ctx.stroke();
  }
  ctx.restore();
}

export function drawJuiceReflections(ctx: CanvasRenderingContext2D, burst: JuiceBurst, bodies: readonly BodyView[], time: number): void {
  if (burst.chain < 4 && !burst.supernova) return;
  ctx.save(); ctx.strokeStyle = '#fff2d8'; ctx.lineWidth = 7;
  const opacity = juiceEnvelope(time, .045, .10, .34) * ctx.globalAlpha;
  for (const body of bodies) {
    const distance = Math.hypot(body.x - burst.x, body.y - burst.y);
    if (distance > 320) continue;
    ctx.globalAlpha = opacity * (1 - distance / 480);
    const facing = Math.atan2(burst.y - body.y, burst.x - body.x);
    ctx.beginPath(); ctx.arc(body.x, body.y, body.radius + 2, facing - 1.1, facing + 1.1); ctx.stroke();
  }
  ctx.restore();
}
