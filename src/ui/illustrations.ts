import { drawBody } from '../render/bodies';

const ART_WIDTH = 240;
const ART_HEIGHT = 120;
export function illustration(step: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ART_WIDTH;
  canvas.height = ART_HEIGHT;
  canvas.className = 'howto-art';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const tokens = getComputedStyle(document.documentElement);
  const color = (name: string) => tokens.getPropertyValue(name).trim();
  const cx = 120;
  const cy = 60;
  ctx.strokeStyle = color('--line');
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, 49, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = color('--core');
  ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fill();
  if (step === 0) {
    drawBody(ctx, 0, cx, 15, 7);
    ctx.strokeStyle = color('--cool'); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, 25); ctx.lineTo(cx, 43);
    ctx.moveTo(cx - 5, 37); ctx.lineTo(cx, 43); ctx.lineTo(cx + 5, 37); ctx.stroke();
  } else if (step === 1) {
    drawBody(ctx, 0, 43, 51, 8); drawBody(ctx, 0, 61, 51, 8);
    drawBody(ctx, 1, 188, 51, 14);
    ctx.strokeStyle = color('--cool');
    ctx.beginPath(); ctx.moveTo(72, 49); ctx.quadraticCurveTo(105, 12, 153, 39); ctx.stroke();
  } else {
    for (let i = 0; i < 6; i++) drawBody(ctx, 2, cx + Math.cos(i * 1.1) * 28, cy + Math.sin(i * 1.1) * 28, 14);
    drawBody(ctx, 3, cx, 14, 17);
    ctx.strokeStyle = color('--danger'); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, 49, -2.15, -1); ctx.stroke();
  }
  return canvas;
}
