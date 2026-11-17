import { DOT_COLORS, GRID, bodyRadius, ease, mixPoint, unit, type DotBody, type MotionChoice, type MotionEvent, type Point } from './dots-motion-model';

const center = GRID / 2;
const LOW = 'rgba(200, 210, 235, 0.07)';
const ACTIVE = ['#cfdcff', '#ffd88a', '#8fb0ff'] as const;

function dot(path: Path2D, x: number, y: number, r: number): void {
  path.moveTo(x + r, y);
  path.arc(x, y, r, 0, Math.PI * 2);
}

const background = new Path2D();
for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) dot(background, x + .5, y + .5, .18);
const ring = new Path2D();
for (let i = 0; i < 100; i++) {
  const angle = i * Math.PI * 2 / 100;
  dot(ring, center + Math.cos(angle) * 28.3, center + Math.sin(angle) * 28.3, .18);
}

function drawField(ctx: CanvasRenderingContext2D, choice: MotionChoice, event: MotionEvent | null, reduced: boolean): void {
  ctx.fillStyle = LOW;
  if (!event || (!event.nova && choice === 'flow')) { ctx.fill(background); return; }

  const crest = Math.sin(Math.PI * event.phase);
  const waveRadius = event.phase * 72;
  const dim = new Path2D(), lit = new Path2D(), tip = new Path2D();
  const { result, from } = event;
  const spread = 10 + event.stage * 2.3;
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const x = col + .5, y = row + .5;
      const dx = result.x - x, dy = result.y - y;
      const distance = Math.hypot(dx, dy);
      const inWave = event.nova && Math.abs(distance - waveRadius) <= (choice === 'flip' ? 2.2 : 4.4);
      const weight = event.nova ? (inWave ? 1 : 0) : unit(1 - distance / spread) * crest;
      const displacement = choice === 'field' && !reduced ? .6 * weight * (event.nova ? -1 : 1) : 0;
      const tx = distance > 0 ? x + dx / distance * displacement : x;
      const ty = distance > 0 ? y + dy / distance * displacement : y;
      // 反転の帯は接触点を通り、一つの点を一度だけ照らす。
      const projection = (x - result.x) * (result.x - from.x) + (y - result.y) * (result.y - from.y);
      const flip = choice === 'flip' && weight > .19 && Math.abs(projection / 12 - (event.phase - .5) * spread) < 1.6;
      if (inWave && Math.abs(distance - waveRadius) < 1.2) dot(tip, tx, ty, .38);
      else if (inWave || flip || (choice === 'field' && weight > .23)) dot(lit, tx, ty, .28);
      else dot(dim, tx, ty, .18);
    }
  }
  ctx.fill(dim);
  ctx.fillStyle = ACTIVE[choice === 'flow' ? 0 : choice === 'flip' ? 1 : 2];
  ctx.globalAlpha = .25; ctx.fill(lit);
  ctx.globalAlpha = .8; ctx.fill(tip); ctx.globalAlpha = 1;
}

type BodyStyle = Readonly<{ scale?: number; dim?: boolean; sweep?: number; vector?: Point }>;

function drawBody(ctx: CanvasRenderingContext2D, body: DotBody, style: BodyStyle = {}): void {
  const radius = bodyRadius(body.tier);
  const scale = style.scale ?? 1;
  if (scale <= .07) return;
  ctx.fillStyle = '#05060a';
  ctx.beginPath(); ctx.arc(body.x, body.y, (radius + .5) * scale, 0, Math.PI * 2); ctx.fill();
  const shell = new Path2D(), surface = new Path2D(), core = new Path2D();
  for (let row = -Math.floor(radius); row <= radius; row++) {
    for (let col = -Math.floor(radius); col <= radius; col++) {
      const distance = Math.hypot(col, row);
      if (distance > radius) continue;
      const x = body.x + col * scale, y = body.y + row * scale;
      const edge = distance > radius - 1.05;
      const pass = style.vector && style.sweep !== undefined
        ? (col * style.vector.x + row * style.vector.y) / (2 * radius) + .5 < style.sweep : false;
      if (pass || distance < radius * (body.tier >= 5 ? .4 : .24)) dot(core, x, y, .38 * scale);
      else if (edge || (body.tier >= 3 && Math.abs(distance - radius * .56) < .45)) dot(shell, x, y, .28 * scale);
      else dot(surface, x, y, .18 * scale);
    }
  }
  ctx.fillStyle = DOT_COLORS[body.tier];
  ctx.globalAlpha = style.dim ? .25 : .5; ctx.fill(surface);
  ctx.globalAlpha = style.dim ? .5 : .8; ctx.fill(shell);
  ctx.globalAlpha = style.dim ? .5 : 1; ctx.fill(core); ctx.globalAlpha = 1;
}

function drawCore(ctx: CanvasRenderingContext2D, heat: number, time: number): void {
  const hot = new Path2D(), low = new Path2D();
  const pulse = heat >= 80 && Math.floor(time * 4) % 2 === 0;
  for (let y = -5; y <= 5; y++) {
    for (let x = -5; x <= 5; x++) {
      const distance = Math.hypot(x, y);
      if (distance > 5.35) continue;
      const bright = distance <= 1.5 + heat * .038;
      dot(bright ? hot : low, center + x, center + y, bright ? .38 : .28);
    }
  }
  ctx.fillStyle = DOT_COLORS[2]; ctx.globalAlpha = .25; ctx.fill(low);
  ctx.fillStyle = pulse ? DOT_COLORS[0] : DOT_COLORS[heat >= 70 ? 4 : 3];
  ctx.globalAlpha = .8; ctx.fill(hot); ctx.globalAlpha = 1;
}

function drawFlow(ctx: CanvasRenderingContext2D, event: MotionEvent): void {
  const { from, result, phase, stage } = event;
  const path = new Path2D();
  for (let n = 0; n < 14 + stage * 2; n++) {
    const t = phase * 1.65 - n * .043;
    if (t < 0 || t > 1) continue;
    const at = mixPoint(from, result, t);
    dot(path, at.x + Math.sin(n * 2.7) * (1 - t), at.y + Math.cos(n * 2.7) * (1 - t), t > .66 ? .38 : .28);
  }
  ctx.fillStyle = DOT_COLORS[event.into.tier]; ctx.globalAlpha = .8; ctx.fill(path); ctx.globalAlpha = 1;
}

function drawContact(ctx: CanvasRenderingContext2D, choice: MotionChoice, event: MotionEvent, reduced: boolean): void {
  const { from, into, result, phase, nova } = event;
  if (nova && phase >= .5) return;
  const closing = reduced ? 0 : ease(unit(phase * 1.85));
  const origin = mixPoint(into, result, closing * (choice === 'field' ? .7 : .92));
  const launch = mixPoint(from, result, closing);
  const dx = result.x - from.x, dy = result.y - from.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const vector = { x: dx / distance, y: dy / distance };
  const sweep = choice === 'flip' ? unit((phase - .12) * 1.6) : undefined;
  if (phase < .57) drawBody(ctx, { ...from, ...launch }, { scale: reduced ? 1 : 1 - closing * .6, dim: phase > .4 });
  if (choice === 'flow' && !reduced && !nova) drawFlow(ctx, event);
  if (phase >= .5 && !nova) {
    const landing = reduced ? into : mixPoint(origin, result, ease((phase - .5) * 2));
    drawBody(ctx, { ...result, ...landing, tier: result.tier }, { sweep, vector });
  } else {
    drawBody(ctx, { ...into, ...origin }, { sweep, vector });
  }
}

export function paintDotsMotion(ctx: CanvasRenderingContext2D, size: number, choice: MotionChoice,
  frame: Readonly<{ bodies: readonly DotBody[]; heat: number; event: MotionEvent | null }>, time: number, reduced: boolean): void {
  const scale = size / GRID;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, GRID, GRID);
  drawField(ctx, choice, frame.event, reduced);
  ctx.fillStyle = LOW; ctx.fill(ring);
  drawCore(ctx, frame.heat, time);
  for (const body of frame.bodies) drawBody(ctx, body);
  if (frame.event) drawContact(ctx, choice, frame.event, reduced);
}

export function paintNextDot(ctx: CanvasRenderingContext2D, size: number, tier: 0 | 1 | 2): void {
  const scale = size / 11;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, 11, 11);
  drawBody(ctx, { x: 5.5, y: 5.5, tier });
}
