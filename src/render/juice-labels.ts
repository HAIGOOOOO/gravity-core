import { CHAIN_MULT_MAX, CHAIN_STEP, TIER_RADIUS } from '../game/constants';
import { juiceEnvelope, type JuiceBurst } from './juice-model';

/** 得点と連鎖数は破片の後へ戻し、文字の下だけ余白を確保する。 */
export function drawJuiceLabels(ctx: CanvasRenderingContext2D, burst: JuiceBurst, age: number, reduced: boolean): void {
  const time = reduced ? .28 : age / (burst.direction === 'echo' ? 1.6 : burst.direction === 'jet' ? .82 : 1);
  const opacity = juiceEnvelope(time, .18, .25, 1.4) * (reduced ? Math.max(0, 1 - age / .9) : 1);
  if (opacity <= 0) return;
  const born = TIER_RADIUS[burst.tier];
  const x = burst.x + born + 20, y = burst.y + born + 38;
  ctx.save(); ctx.translate(x, y); ctx.globalAlpha *= opacity;
  ctx.font = '900 30px system-ui, sans-serif'; ctx.textAlign = 'left';
  const score = `+${burst.score.toLocaleString('ja-JP')}`;
  const width = Math.max(ctx.measureText(score).width, burst.chain >= 2 ? 118 : 0);
  ctx.fillStyle = '#070b18'; ctx.fillRect(-8, -30, width + 16, burst.chain >= 2 ? 91 : 61);
  ctx.fillStyle = '#fff2d8'; ctx.fillText(score, 0, 0);
  ctx.fillStyle = '#f5ab42'; ctx.font = '900 22px system-ui, sans-serif';
  ctx.fillText(`×${Math.min(CHAIN_MULT_MAX, 1 + CHAIN_STEP * (burst.chain - 1)).toFixed(1)}`, 0, 26);
  if (burst.chain >= 2) ctx.fillText(`${burst.chain}連鎖`, 0, 52);
  ctx.restore();
}
