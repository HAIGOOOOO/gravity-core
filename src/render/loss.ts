import type { GameSnapshot } from '../contracts/game';
import { LAUNCH_RADIUS, REPEAT_LAUNCH_ANGLE } from '../game/constants';

/** 終了時に判定側が渡した対象だけを示す。表示側で敗因や「惜しい」を作らない。 */
export function drawLossMarker(ctx: CanvasRenderingContext2D, snapshot: GameSnapshot): void {
  const loss = snapshot.loss;
  if (!loss) return;
  ctx.save(); ctx.strokeStyle = '#ff9398'; ctx.lineWidth = 5;
  if (loss.kind === 'overLimit') {
    const body = loss.culprit;
    ctx.beginPath(); ctx.arc(body.x, body.y, body.radius + 9, 0, Math.PI * 2); ctx.stroke();
    const near = loss.nearFusion;
    if (near) {
      const other = snapshot.bodies.find(b => b.id === near.bodyIds[1]);
      if (other) {
        ctx.strokeStyle = '#c5f4cb'; ctx.lineWidth = 3; ctx.setLineDash([8, 5]);
        ctx.beginPath(); ctx.moveTo(body.x, body.y); ctx.lineTo(other.x, other.y); ctx.stroke();
        ctx.beginPath(); ctx.arc(other.x, other.y, other.radius + 7, 0, Math.PI * 2); ctx.stroke();
      }
    }
  } else if (loss.kind === 'repeatLaunch') {
    ctx.lineWidth = 9; ctx.strokeStyle = '#ffbf85';
    ctx.beginPath(); ctx.arc(0, 0, LAUNCH_RADIUS + 8, loss.angleRadians - REPEAT_LAUNCH_ANGLE, loss.angleRadians + REPEAT_LAUNCH_ANGLE); ctx.stroke();
  }
  ctx.restore();
}
