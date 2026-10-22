import type { BoardFrame } from '../contracts/app';
import { CHAIN_WINDOW_SECONDS, HEAT_MAX, LAUNCH_RADIUS, LIMIT_RADIUS, TICK_HZ, TIER_RADIUS } from '../game/constants';
import { fusionCooling } from '../game/heat';
import { chainTargetLabel, STRINGS } from '../ui/strings';
import { drawBody } from './bodies';
import { drawPlayingBodies } from './playing-bodies';

/** 操作の線は光の面と混ぜず、暗い下縁を付けて最前面へ置く。 */
export function drawBoardForeground(ctx: CanvasRenderingContext2D, frame: BoardFrame): void {
  ctx.save();
  drawPlayingBodies(ctx, frame);
  ctx.strokeStyle = '#070b18'; ctx.lineWidth = frame.curr.overLimit ? 7 : 5;
  ctx.beginPath(); ctx.arc(0, 0, LIMIT_RADIUS, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = frame.curr.overLimit ? '#FF7D83' : 'rgba(145,160,184,0.85)';
  ctx.lineWidth = frame.curr.overLimit ? 3 : 1.5; ctx.setLineDash([10, 8]); ctx.stroke(); ctx.setLineDash([]);
  const targets = frame.curr.bodies.filter((b) => b.chain > 0 && b.chainUntilTick > frame.curr.tick);
  const hero = targets.reduce<(typeof targets)[number] | null>((best, b) => !best || b.chain > best.chain ? b : best, null);
  for (const b of targets) {
    const left = Math.min(1, (b.chainUntilTick - frame.curr.tick) / (CHAIN_WINDOW_SECONDS * TICK_HZ));
    ctx.strokeStyle = '#101b1a'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(b.x, b.y, b.radius + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); ctx.stroke();
    ctx.strokeStyle = '#b2e6bc'; ctx.lineWidth = 4; ctx.stroke();
    if (b === hero) {
      const x = Math.max(-220, Math.min(220, b.x)), y = Math.max(-290, Math.min(290, b.y - b.radius - 25));
      ctx.font = '700 27px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 6; ctx.strokeStyle = '#101b1a'; ctx.fillStyle = '#c5f4cb';
      const text = chainTargetLabel(b.chain + 1, fusionCooling(HEAT_MAX, b.chain + 1, b.tier === 8));
      ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
    }
  }
  const { aim } = frame;
  if (aim) {
    const ox = LAUNCH_RADIUS * Math.cos(aim.originAngleRadians), oy = LAUNCH_RADIUS * Math.sin(aim.originAngleRadians);
    drawBody(ctx, aim.tier, ox, oy, TIER_RADIUS[aim.tier], { alpha: 0.8 });
    const prediction = aim.prediction;
    const growth = frame.aimGuide ? prediction?.mergePreview : undefined;
    if (growth) {
      ctx.setLineDash([5, 5]); ctx.lineWidth = 3;
      ctx.strokeStyle = growth.mayCrossLimit ? '#FF7D83' : '#b2e6bc';
      ctx.beginPath(); ctx.arc(growth.x, growth.y, growth.radius, 0, Math.PI * 2); ctx.stroke();
      for (const b of growth.pushed) { ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.stroke(); }
      ctx.setLineDash([]); ctx.font = '700 25px system-ui,sans-serif'; ctx.textAlign = 'center';
      const x = Math.max(-210, Math.min(210, growth.x)), y = Math.max(-290, Math.min(290, growth.y + growth.radius + 32));
      const text = growth.mayCrossLimit ? STRINGS.growthRisk : STRINGS.growthPreview;
      ctx.strokeStyle = '#101b1a'; ctx.lineWidth = 6; ctx.strokeText(text, x, y);
      ctx.fillStyle = growth.mayCrossLimit ? '#FF7D83' : '#b2e6bc'; ctx.fillText(text, x, y);
    }
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
  if (parent?.id !== 'board-wrap' && parent?.id !== 'stage') return null;
  const existing = parent.querySelector<HTMLCanvasElement>('canvas[data-board-foreground]');
  if (existing) return existing;
  const top = document.createElement('canvas'); top.dataset.boardForeground = '';
  top.setAttribute('aria-hidden', 'true');
  Object.assign(top.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '1' });
  parent.append(top); return top;
}
