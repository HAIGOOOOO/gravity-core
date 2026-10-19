import type { BoardFrame } from '../contracts/app';
import { LAUNCH_RADIUS, LIMIT_RADIUS, TIER_RADIUS } from '../game/constants';
import { drawBody } from './bodies';

/** 操作の線は光の面と混ぜず、暗い下縁を付けて最前面へ置く。 */
export function drawBoardForeground(ctx: CanvasRenderingContext2D, frame: BoardFrame): void {
  ctx.save();
  ctx.strokeStyle = '#070b18'; ctx.lineWidth = frame.curr.overLimit ? 7 : 5;
  ctx.beginPath(); ctx.arc(0, 0, LIMIT_RADIUS, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = frame.curr.overLimit ? '#FF7D83' : 'rgba(145,160,184,0.85)';
  ctx.lineWidth = frame.curr.overLimit ? 3 : 1.5; ctx.setLineDash([10, 8]); ctx.stroke(); ctx.setLineDash([]);
  const { aim } = frame;
  if (aim) {
    const ox = LAUNCH_RADIUS * Math.cos(aim.originAngleRadians), oy = LAUNCH_RADIUS * Math.sin(aim.originAngleRadians);
    drawBody(ctx, aim.tier, ox, oy, TIER_RADIUS[aim.tier], { alpha: 0.8 });
    const prediction = aim.prediction;
    if (frame.aimGuide && prediction && prediction.points.length > 1) {
      const last = prediction.points[prediction.points.length - 1];
      for (const underlay of [true, false]) {
        ctx.strokeStyle = underlay ? '#070b18' : aim.invalid ? '#FF7D83' : prediction.willMerge ? '#83D9FF' : '#F7F7F2';
        ctx.lineWidth = underlay ? 7 : 2; ctx.setLineDash(underlay ? [] : [6, 6]);
        ctx.beginPath(); ctx.moveTo(prediction.points[0].x, prediction.points[0].y);
        for (const point of prediction.points) ctx.lineTo(point.x, point.y);
        ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(last.x, last.y, TIER_RADIUS[aim.tier], 0, Math.PI * 2); ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** 2枚の盤面を重ねる本体だけに、入力を受けない前景を足す。見本の単独canvasは増やさない。 */
export function createBoardForeground(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const parent = canvas.parentElement;
  if (parent?.id !== 'board-wrap') return null;
  const existing = parent.querySelector<HTMLCanvasElement>('canvas[data-board-foreground]');
  if (existing) return existing;
  const top = document.createElement('canvas'); top.dataset.boardForeground = '';
  top.setAttribute('aria-hidden', 'true');
  Object.assign(top.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '1' });
  parent.append(top); return top;
}
