import type { PracticeShot, RuleSession } from './rules-session';
import { applyLogicalTransform } from '../shared/coords';
import { LAUNCH_RADIUS, TICK_HZ } from '../game/constants';
import type { RepeatHeatingZone } from './rules-repeat-zones';
import type { GameEvent, GameSnapshot } from '../contracts/game';

export type ContactMark = Readonly<{ prev: GameSnapshot; event: GameEvent }>;

/** 比較の線は見本だけ。実際の天体や入力の位置を書き換えない。 */
export function drawRuleTrace(ctx: CanvasRenderingContext2D, study: RuleSession, enabled: boolean, snapshot: GameSnapshot, reviewing: boolean, heatZones: readonly RepeatHeatingZone[], mark?: ContactMark, third?: PracticeShot): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!reviewing && (study.mode === 'learn' || study.mode === 'collapse')) {
    const { waiting, preparation } = study.read();
    if (waiting && (study.mode === 'learn' || preparation === 'ready')) {
      applyLogicalTransform(ctx); ctx.strokeStyle = '#f6e3aa'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(0, -LAUNCH_RADIUS, 28, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -LAUNCH_RADIUS + 35); ctx.lineTo(0, -LAUNCH_RADIUS + 65); ctx.stroke();
    }
  }
  if (study.mode === 'repeat' || study.mode === 'loss-repeat') {
    applyLogicalTransform(ctx); ctx.lineWidth = 12; ctx.strokeStyle = '#ff9398';
    for (const zone of heatZones) {
      ctx.beginPath(); ctx.arc(0, 0, LAUNCH_RADIUS, zone.start, zone.end); ctx.stroke();
    }
    if (study.mode === 'repeat') drawRepeatLaunches(ctx, snapshot, third);
  }
  // 判定済みの天体だけを指す。輪郭の大きさから加熱を推測しない。
  if (!snapshot.loss) {
    applyLogicalTransform(ctx); ctx.lineWidth = 5; ctx.strokeStyle = '#ff7d83';
    for (const body of snapshot.bodies) if (body.overLimit) {
      ctx.beginPath(); ctx.arc(body.x, body.y, body.radius + 8, 0, Math.PI * 2); ctx.stroke();
    }
  }
  if (mark) {
    applyLogicalTransform(ctx); ctx.lineWidth = 5; ctx.strokeStyle = '#f6e3aa'; ctx.setLineDash([7, 6]);
    for (const id of mark.event.bodyIds?.slice(0, 2) ?? []) {
      const body = mark.prev.bodies.find(b => b.id === id);
      if (body) { ctx.beginPath(); ctx.arc(body.x, body.y, body.radius + 4, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.setLineDash([]);
    const result = snapshot.bodies.find(b => b.id === mark.event.bodyIds?.[2]);
    if (result) {
      ctx.strokeStyle = '#a3efd0';
      ctx.beginPath(); ctx.arc(result.x, result.y, result.radius + 7, 0, Math.PI * 2); ctx.stroke();
    }
  }
  if (reviewing || !enabled || study.mode !== 'growth') return;
  const { finished, curr } = study.read();
  if (!finished) return;
  applyLogicalTransform(ctx); ctx.lineWidth = 3;
  for (const b of study.before.bodies) {
    ctx.setLineDash([3, 7]); ctx.strokeStyle = '#bdc3bc';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.stroke();
    const actual = curr.bodies.find((body) => body.id === b.id);
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

function drawRepeatLaunches(ctx: CanvasRenderingContext2D, snapshot: GameSnapshot, third?: PracticeShot): void {
  const recent = snapshot.recentLaunches ?? [];
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 27px system-ui,sans-serif';
  for (const [number, shot] of recent.entries()) {
    const a = shot.originAngleRadians, x = Math.cos(a), y = Math.sin(a);
    const color = number === 2 ? (third?.heat ? '#ff9398' : '#a3efd0') : '#f6e3aa';
    const distance = LAUNCH_RADIUS - 35 - number * 32;
    ctx.fillStyle = '#0c131b'; ctx.beginPath(); ctx.arc(x * distance, y * distance, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color; ctx.fillText(String(number + 1), x * distance, y * distance);
    if (number === 2 && third?.heat) {
      const elapsed = (snapshot.tick - shot.tick) / TICK_HZ;
      ctx.strokeStyle = color; ctx.lineWidth = 7 + Math.max(0, 1 - elapsed / .4) * 9;
      ctx.beginPath(); ctx.arc(0, 0, LAUNCH_RADIUS, a - .08, a + .08); ctx.stroke();
    }
  }
  ctx.textBaseline = 'alphabetic';
}
