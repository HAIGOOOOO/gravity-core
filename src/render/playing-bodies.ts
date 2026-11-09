import type { BoardFrame } from '../contracts/app';
import { CORE_RADIUS, HEAT_MAX, TICK_HZ } from '../game/constants';
import { HEAT_STATE_COLOR, heatState } from '../shared/heat';
import { drawBody } from './bodies';

/** 盤面と前景で同じ補間を使い、光の中でも実際の天体の位置と輪郭を残す。 */
export function drawPlayingBodies(ctx: CanvasRenderingContext2D, frame: BoardFrame): void {
  const before = new Map(frame.prev.bodies.map((b) => [b.id, b]));
  for (const b of frame.curr.bodies) {
    const p = before.get(b.id);
    const x = p ? p.x + (b.x - p.x) * frame.alpha : b.x;
    const y = p ? p.y + (b.y - p.y) * frame.alpha : b.y;
    ctx.save(); ctx.translate(x, y);
    const age = (frame.curr.tick - b.bornTick) / TICK_HZ;
    if (!frame.reducedMotion && b.chain > 0 && age >= 0 && age < 0.28) {
      const bounce = Math.sin(age / 0.28 * Math.PI * 2) * (1 - age / 0.28);
      ctx.scale(1 + bounce * 0.1, 1 - bounce * 0.08);
    }
    drawBody(ctx, b.tier, 0, 0, b.radius, { seed: b.id, timeSeconds: frame.timeSeconds });
    ctx.restore();
    if (b.overLimit) {
      ctx.strokeStyle = '#FF7D83'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, b.radius + 2, 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.fillStyle = '#FFB45E'; ctx.beginPath(); ctx.arc(0, 0, CORE_RADIUS, 0, Math.PI * 2); ctx.fill();
  if (frame.curr.heat > 0) {
    ctx.strokeStyle = HEAT_STATE_COLOR[heatState(frame.curr.heat)]; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(0, 0, CORE_RADIUS - 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frame.curr.heat / HEAT_MAX); ctx.stroke();
  }
}
