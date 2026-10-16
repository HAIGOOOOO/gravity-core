import type { GameSnapshot, Prediction, Tier } from '../contracts/game';
import { BOARD_SIZE, CORE_RADIUS, HEAT_MAX, LAUNCH_RADIUS, LIMIT_RADIUS, TIER_COLOR } from '../game/constants';
import type { LookPalette } from './look-palette';

const TAU = Math.PI * 2;
const MARKS = 48;
const WARNING_WIDTH = 28;
type StudyLabels = { launch: string; limit: string; aim: string };

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
}

export function drawLookBody(ctx: CanvasRenderingContext2D, palette: LookPalette, tier: Tier, x: number, y: number, r: number): void {
  ctx.save(); ctx.translate(x, y);
  const print = palette.id === 'print';
  const instrument = palette.id === 'instrument';
  circle(ctx, 0, 0, r);
  // 小さな岩は輪郭、育った天体は表面で区別する。細線を全種へ重ねない。
  if (tier === 1 || tier === 2) {
    const sides = tier === 1 ? 5 : 7;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = i / sides * TAU - 0.3; const length = r * (i % 2 ? 0.84 : 1);
      if (i === 0) ctx.moveTo(Math.cos(a) * length, Math.sin(a) * length);
      else ctx.lineTo(Math.cos(a) * length, Math.sin(a) * length);
    }
    ctx.closePath();
  }
  if (print) {
    ctx.fillStyle = tier % 3 === 0 ? palette.ink : tier % 3 === 1 ? palette.bg : palette.accent;
    ctx.fill(); ctx.strokeStyle = palette.ink; ctx.lineWidth = Math.max(2, r * 0.055); ctx.stroke();
    ctx.clip();
    ctx.fillStyle = tier % 3 === 0 ? palette.bg : palette.ink;
    ctx.beginPath(); ctx.ellipse(r * 0.54, r * 0.14, r * 0.76, r * 1.12, -0.4, 0, TAU); ctx.fill();
    ctx.strokeStyle = tier % 3 === 0 ? palette.bg : palette.ink;
    ctx.lineWidth = 1.6;
    for (let i = 0; i < (tier >= 4 ? 3 : 0); i++) {
      const offset = (i / 3 * 1.3 - 0.5) * r;
      ctx.beginPath(); ctx.moveTo(-r, offset); ctx.lineTo(r, offset - r * 0.5); ctx.stroke();
    }
  } else if (instrument) {
    ctx.fillStyle = palette.bg; ctx.fill(); ctx.strokeStyle = palette.accent; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.clip(); ctx.fillStyle = palette.accent;
    ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.25, r * 0.9, 0, TAU); ctx.fill();
    ctx.strokeStyle = palette.bg; ctx.lineWidth = 2;
    for (let i = 1; i <= (tier >= 4 ? 2 : 0); i++) { circle(ctx, r * 0.5, r * 0.1, r * i * 0.5); ctx.stroke(); }
  } else {
    const glow = ctx.createRadialGradient(-r * 0.4, -r * 0.45, r * 0.05, r * 0.3, r * 0.3, r * 1.5);
    glow.addColorStop(0, TIER_COLOR[tier]); glow.addColorStop(0.48, TIER_COLOR[tier]); glow.addColorStop(1, palette.bg);
    ctx.fillStyle = glow; ctx.fill(); ctx.clip();
    ctx.fillStyle = palette.bg; ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.ellipse(r * 0.72, r * 0.15, r * 0.72, r * 1.2, -0.45, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.ink; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.96, -2.9, -0.4); ctx.stroke();
  }
  if (tier === 3 || tier === 4) {
    ctx.fillStyle = palette.bg; ctx.globalAlpha = 0.65;
    circle(ctx, -r * 0.34, -r * 0.2, r * 0.2); ctx.fill();
    circle(ctx, -r * 0.1, r * 0.42, r * 0.12); ctx.fill();
  }
  ctx.restore();
  // 大きい階級には外形の手掛かりを付ける。色だけの比較にしない。
  if (tier === 6) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.35);
    ctx.strokeStyle = print ? palette.ink : palette.accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 0, r * 1.36, r * 0.4, 0, 0, TAU); ctx.stroke(); ctx.restore();
  }
  if (tier >= 7) {
    ctx.save(); ctx.strokeStyle = print ? palette.ink : palette.accent; ctx.lineWidth = 2;
    const rays = tier === 7 ? 8 : 12;
    for (let i = 0; i < rays; i++) {
      const a = i / rays * TAU;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 1.08, y + Math.sin(a) * r * 1.08);
      ctx.lineTo(x + Math.cos(a) * r * 1.23, y + Math.sin(a) * r * 1.23); ctx.stroke();
    }
    ctx.restore();
  }
}

export function drawLookStudy(canvas: HTMLCanvasElement, snapshot: GameSnapshot, palette: LookPalette, prediction: Prediction, labels: StudyLabels): void {
  const ctx = canvas.getContext('2d')!;
  const css = canvas.getBoundingClientRect().width;
  const pixelRatio = Math.min(devicePixelRatio, 2);
  canvas.width = Math.round(css * pixelRatio); canvas.height = canvas.width;
  const scale = canvas.width / BOARD_SIZE;
  ctx.setTransform(scale, 0, 0, scale, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = palette.bg; ctx.fillRect(-BOARD_SIZE / 2, -BOARD_SIZE / 2, BOARD_SIZE, BOARD_SIZE);
  const print = palette.id === 'print'; const instrument = palette.id === 'instrument';
  if (print) {
    ctx.strokeStyle = palette.line; ctx.lineWidth = 1;
    for (const x of [-BOARD_SIZE * 0.42, BOARD_SIZE * 0.42]) {
      ctx.beginPath(); ctx.moveTo(x, -BOARD_SIZE * 0.4); ctx.lineTo(x, BOARD_SIZE * 0.4); ctx.stroke();
    }
  } else if (!instrument) {
    const halo = ctx.createRadialGradient(0, 0, CORE_RADIUS, 0, 0, LIMIT_RADIUS);
    halo.addColorStop(0, '#403526'); halo.addColorStop(1, palette.bg);
    ctx.fillStyle = halo; circle(ctx, 0, 0, LIMIT_RADIUS); ctx.fill();
    const stars = [[-370,-250],[-190,390],[270,-370],[355,210],[-410,70],[140,-400],[305,350]];
    ctx.fillStyle = palette.muted;
    for (const [x,y] of stars) { circle(ctx, x!, y!, 1.4); ctx.fill(); }
  }
  ctx.strokeStyle = palette.line; ctx.lineWidth = instrument ? 2 : 1;
  circle(ctx, 0, 0, LAUNCH_RADIUS); ctx.stroke();
  if (instrument) {
    for (let i = 0; i < MARKS; i++) {
      const angle = i / MARKS * TAU; const length = i % 4 === 0 ? 17 : 6;
      ctx.beginPath(); ctx.moveTo(Math.cos(angle) * (LAUNCH_RADIUS - length), Math.sin(angle) * (LAUNCH_RADIUS - length));
      ctx.lineTo(Math.cos(angle) * LAUNCH_RADIUS, Math.sin(angle) * LAUNCH_RADIUS); ctx.stroke();
    }
  }
  // 内側の薄い帯と、危険方向だけの太線。常に外周全部を警告色にしない。
  ctx.globalAlpha = 0.1; ctx.strokeStyle = palette.accent; ctx.lineWidth = WARNING_WIDTH;
  circle(ctx, 0, 0, LIMIT_RADIUS - WARNING_WIDTH / 2); ctx.stroke(); ctx.globalAlpha = 1;
  ctx.strokeStyle = palette.muted; ctx.lineWidth = print ? 4 : 3;
  circle(ctx, 0, 0, LIMIT_RADIUS); ctx.stroke();
  for (const body of snapshot.bodies) {
    if (!body.overLimit && Math.hypot(body.x, body.y) + body.radius < LIMIT_RADIUS - WARNING_WIDTH) continue;
    const angle = Math.atan2(body.y, body.x);
    ctx.strokeStyle = body.overLimit ? palette.danger : palette.accent; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(0, 0, LIMIT_RADIUS, angle - 0.12, angle + 0.12); ctx.stroke();
  }
  // 核を先に描き、前の天体で遮れるようにする。
  ctx.fillStyle = print ? palette.ink : palette.accent; circle(ctx, 0, 0, CORE_RADIUS); ctx.fill();
  ctx.strokeStyle = palette.accent; ctx.lineWidth = 4;
  circle(ctx, 0, 0, CORE_RADIUS + 13); ctx.stroke();
  for (const body of snapshot.bodies) drawLookBody(ctx, palette, body.tier, body.x, body.y, body.radius);
  // 同じ入力の予測を全案に使う。表示するのは実際の予測点だけ。
  drawLookBody(ctx, palette, snapshot.nextQueue[0], 0, -LAUNCH_RADIUS, 20);
  ctx.fillStyle = palette.ink;
  prediction.points.forEach((point, i) => { if (i % 2 === 0) { circle(ctx, point.x, point.y, 3); ctx.fill(); } });
  const end = prediction.points.at(-1);
  if (end) { ctx.strokeStyle = palette.accent; ctx.lineWidth = 4; circle(ctx, end.x, end.y, 21); ctx.stroke(); }
  ctx.fillStyle = palette.ink; ctx.font = `${BOARD_SIZE / css * 11}px system-ui, sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(labels.launch, 30, -LAUNCH_RADIUS);
  ctx.fillText(labels.aim, 30, -LAUNCH_RADIUS + 42);
  ctx.fillText(labels.limit, -LIMIT_RADIUS + 12, LIMIT_RADIUS + 34);
  ctx.strokeStyle = palette.danger; ctx.lineWidth = print ? 10 : 5;
  ctx.beginPath(); ctx.arc(0, 0, CORE_RADIUS - 10, -Math.PI / 2, -Math.PI / 2 + TAU * snapshot.heat / HEAT_MAX); ctx.stroke();
}
