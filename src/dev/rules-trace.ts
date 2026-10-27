import type { RuleSession } from './rules-session';
import { applyLogicalTransform } from '../shared/coords';
import { LAUNCH_RADIUS } from '../game/constants';
import { repeatHeatingZones } from './rules-repeat-zones';
import type { LessonFrame } from './rules-replay';

/** 比較の線は見本だけ。実際の天体や入力の位置を書き換えない。 */
export function drawRuleTrace(ctx: CanvasRenderingContext2D, study: RuleSession, enabled: boolean, review: LessonFrame | null = null): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const snapshot = review?.curr ?? study.read().curr;
  if (!review && study.mode === 'learn' && study.read().waiting) {
    applyLogicalTransform(ctx); ctx.strokeStyle = '#f6e3aa'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, -LAUNCH_RADIUS, 28, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -LAUNCH_RADIUS + 35); ctx.lineTo(0, -LAUNCH_RADIUS + 65); ctx.stroke();
  }
  if (study.mode === 'repeat') {
    applyLogicalTransform(ctx); ctx.lineWidth = 12; ctx.strokeStyle = '#ff9398';
    for (const zone of repeatHeatingZones(snapshot)) {
      ctx.beginPath(); ctx.arc(0, 0, LAUNCH_RADIUS, zone.start, zone.end); ctx.stroke();
    }
    ctx.strokeStyle = '#f6e3aa'; ctx.lineWidth = 3;
    for (const shot of snapshot.recentLaunches ?? []) {
      const a = shot.originAngleRadians;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * (LAUNCH_RADIUS - 20), Math.sin(a) * (LAUNCH_RADIUS - 20));
      ctx.lineTo(Math.cos(a) * (LAUNCH_RADIUS + 20), Math.sin(a) * (LAUNCH_RADIUS + 20)); ctx.stroke();
    }
  }
  // 判定済みの天体だけを指す。輪郭の大きさから加熱を推測しない。
  if (!snapshot.loss) {
    applyLogicalTransform(ctx); ctx.lineWidth = 5; ctx.strokeStyle = '#ff7d83';
    for (const body of snapshot.bodies) if (body.overLimit) {
      ctx.beginPath(); ctx.arc(body.x, body.y, body.radius + 8, 0, Math.PI * 2); ctx.stroke();
    }
  }
  if (review) {
    applyLogicalTransform(ctx); ctx.lineWidth = 5; ctx.strokeStyle = '#f6e3aa'; ctx.setLineDash([7, 6]);
    const event = review.events.find(e => e.kind === 'merge' || e.kind === 'supernova');
    for (const id of event?.bodyIds?.slice(0, 2) ?? []) {
      const body = review.prev.bodies.find(b => b.id === id);
      if (body) { ctx.beginPath(); ctx.arc(body.x, body.y, body.radius + 3, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.setLineDash([]); return;
  }
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
