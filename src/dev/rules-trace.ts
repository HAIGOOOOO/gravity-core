import type { RuleSession } from './rules-session';
import { applyLogicalTransform } from '../shared/coords';

/** 比較の線は見本だけ。実際の天体や入力の位置を書き換えない。 */
export function drawRuleTrace(ctx: CanvasRenderingContext2D, study: RuleSession, enabled: boolean): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!enabled || study.mode !== 'growth' || !study.read().finished) return;
  applyLogicalTransform(ctx); ctx.lineWidth = 3;
  for (const b of study.before.bodies) {
    ctx.setLineDash([3, 7]); ctx.strokeStyle = '#bdc3bc';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.stroke();
    const actual = study.read().curr.bodies.find((body) => body.id === b.id);
    if (actual) {
      ctx.setLineDash([]); ctx.strokeStyle = '#83d9ff';
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(actual.x, actual.y); ctx.stroke();
    }
  }
  const preview = study.prediction?.mergePreview;
  if (preview) for (const b of [preview, ...preview.pushed]) {
    ctx.setLineDash([9, 6]); ctx.strokeStyle = '#ff7d83';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.setLineDash([]);
}
