import type { GameEvent, GameSnapshot } from '../contracts/game';
import { BOARD_SIZE, TICK_HZ, TIER_NAMES } from '../game/constants';
import type { DefeatCause } from '../replay';
import { applyLogicalTransform } from '../shared/coords';

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  // 390px幅でも15px程度を保つ。長い説明は盤面の下へ置く。
  ctx.font = '40px sans-serif';
  const width = ctx.measureText(text).width + 24;
  const left = Math.max(-BOARD_SIZE / 2 + 20, Math.min(BOARD_SIZE / 2 - width - 20, x));
  const top = Math.max(-BOARD_SIZE / 2 + 70, Math.min(BOARD_SIZE / 2 - 30, y));
  ctx.fillStyle = '#070b18'; ctx.fillRect(left - 12, top - 43, width, 64);
  ctx.fillStyle = '#f7f7f2'; ctx.fillText(text, left, top);
}

export function annotateCause(canvas: HTMLCanvasElement, snap: GameSnapshot, cause: DefeatCause): void {
  const ctx = canvas.getContext('2d')!;
  applyLogicalTransform(ctx);
  const primary = cause.culprits[0]?.id;
  for (const culprit of cause.culprits) {
    const body = snap.bodies.find((b) => b.id === culprit.id);
    if (!body) continue;
    ctx.strokeStyle = body.id === primary ? '#f7f7f2' : '#91a0b8';
    ctx.lineWidth = body.id === primary ? 7 : 2;
    ctx.setLineDash(body.id === primary ? [] : [8, 10]);
    ctx.beginPath(); ctx.arc(body.x, body.y, body.radius + 14, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.setLineDash([]);
  const marked = snap.bodies.find((b) => b.id === primary);
  if (!marked) return;
  const x = Math.min(BOARD_SIZE / 2 - 410, marked.x - 200);
  const y = marked.y - marked.radius - 100;
  label(ctx, marked.overLimit ? '限界線を越えた天体' : '限界線へ向かう天体', x, y);
  const tipY = marked.y - marked.radius - 24;
  ctx.strokeStyle = '#f7f7f2'; ctx.fillStyle = '#f7f7f2'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(x + 200, y + 22); ctx.lineTo(marked.x, tipY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(marked.x, tipY + 12); ctx.lineTo(marked.x - 12, tipY - 8); ctx.lineTo(marked.x + 12, tipY - 8); ctx.closePath(); ctx.fill();
}

export function annotateMerge(
  canvas: HTMLCanvasElement, snap: GameSnapshot, before: GameSnapshot,
  events: readonly GameEvent[],
): string {
  let event: GameEvent | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const candidate = events[i]!;
    if ((candidate.kind === 'merge' || candidate.kind === 'supernova') &&
      snap.tick >= candidate.tick && snap.tick - candidate.tick <= TICK_HZ) { event = candidate; break; }
  }
  if (!event || event.x === undefined || event.y === undefined) return '';
  const child = snap.bodies.find((body) => body.id === event!.bodyIds?.[2]);
  const x = child?.x ?? event.x;
  const y = child?.y ?? event.y;
  const ctx = canvas.getContext('2d')!;
  applyLogicalTransform(ctx);
  ctx.strokeStyle = '#f7f7f2'; ctx.lineWidth = 5;
  for (const id of event.bodyIds?.slice(0, 2) ?? []) {
    const body = before.bodies.find((b) => b.id === id);
    if (!body) continue;
    ctx.beginPath(); ctx.moveTo(body.x, body.y); ctx.lineTo(x, y); ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(x, y, (child?.radius ?? 21) + 14, 0, Math.PI * 2); ctx.stroke();
  label(ctx, `${event.chain ?? 1} 連鎖`, x - 80, y - 65);
  const name = event.resultTier === undefined ? '超新星' : `${TIER_NAMES[event.resultTier]}が生まれた`;
  return `${event.chain ?? 1}連鎖：${name}（+${event.scoreDelta ?? 0}点）`;
}
