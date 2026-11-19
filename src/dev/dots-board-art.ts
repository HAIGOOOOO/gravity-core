import type { BodyView, GameSnapshot, Tier } from '../contracts/game';
import { BOARD_SIZE, CORE_RADIUS, HEAT_MAX, LAUNCH_RADIUS, LIMIT_RADIUS } from '../game/constants';
import type { DotsImpact } from './dots-motion';
import { drawDotsImpact } from './dots-motion-effects';

export type DotsVariant = 'a' | 'b' | 'c';
type DotRadius = .18 | .28 | .38 | .46;
type Brightness = .07 | .25 | .5 | .8 | 1;
type Body = { x: number; y: number; tier: Tier; radius?: number; angle?: number };

const BACKGROUND = '#05060a';
const DUST = '#c8d2eb';
const INK = '#eeede8';
const LABEL = '#a8a79f';
const STELLAR = ['#ff5a3c', '#ff8a45', '#ffb35c', '#ffd88a', '#fff1d0', '#f2f4ff', '#cfdcff', '#a9c2ff', '#8fb0ff'] as const;
// 最小天体でも直径に7点入る。これは画面案での寸法で、本番当たり判定とは独立。
const RADIUS = [18, 22, 28, 34, 41, 48, 56, 64, 73];
const BOARD = 366;
const CENTER = BOARD / 2;
const BODIES: readonly Body[] = [
  { x: 86, y: 171, tier: 0 },
  { x: 152, y: 87, tier: 2 },
  { x: 205, y: 99, tier: 2 },
  { x: 112, y: 243, tier: 3 },
  { x: 260, y: 237, tier: 4 },
  { x: 208, y: 306, tier: 6 },
];
const IMPACT = { x: 178, y: 93 };
const HEAT = .38;
const TAU = Math.PI * 2;

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, brightness: Brightness): void {
  ctx.fillStyle = color;
  ctx.globalAlpha = brightness;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fill();
}

function context(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, width, height);
  return ctx;
}

function planet(ctx: CanvasRenderingContext2D, body: Body, pitch: number, variant: DotsVariant, size = RADIUS[body.tier]!): void {
  ctx.save();
  ctx.translate(body.x, body.y);
  ctx.rotate(body.angle ?? 0);
  pitch = Math.min(pitch, size / 3.25);
  const steps = Math.floor(size / pitch);
  const color = STELLAR[body.tier];
  // 背景の格子とは独立した点の並び。暗い縁取りで重なりを分ける。
  dot(ctx, 0, 0, size + pitch * .28, BACKGROUND, 1);
  for (let row = -steps; row <= steps; row++) {
    for (let col = -steps; col <= steps; col++) {
      const x = col * pitch;
      const y = row * pitch;
      const r = Math.hypot(x, y);
      if (r > size) continue;
      const rim = r >= size - pitch * 1.04;
      const equator = Math.abs(x * .42 + y * .91) / size;
      const onAxis = body.tier === 0 && (row === 0 || col === 0);
      const facing = (-x - y * .56) / size;
      let radius: DotRadius = .28;
      let light: Brightness = .5;
      if (variant === 'a') {
        light = rim ? .8 : facing > .24 ? 1 : facing > -.24 ? .8 : .5;
        radius = rim || facing > .15 ? .38 : .28;
      } else if (variant === 'b') {
        const innerRing = Math.abs(r - size * .55) < pitch * .48;
        light = rim || onAxis ? .8 : innerRing ? .5 : r < size * .29 ? 1 : .25;
        radius = rim || r < size * .29 ? .38 : .18;
      } else {
        const belt = equator < .19;
        light = rim || onAxis || belt ? 1 : facing > .14 ? .8 : .25;
        radius = rim || belt ? .38 : .18;
      }
      dot(ctx, x, y, pitch * radius, color, light);
    }
  }
  ctx.restore();
}

function star(ctx: CanvasRenderingContext2D, pitch: number, variant: DotsVariant, heat = HEAT, width = 26): void {
  dot(ctx, CENTER, CENTER, width + pitch * .5, BACKGROUND, 1);
  const cells = Math.ceil(width / pitch);
  const fillRadius = width * Math.sqrt(Math.max(0, heat));
  for (let row = -cells; row <= cells; row++) {
    for (let col = -cells; col <= cells; col++) {
      const x = col * pitch;
      const y = row * pitch;
      const r = Math.hypot(x, y);
      if (r > width) continue;
      const rim = r > width - pitch;
      const active = r <= fillRadius || (variant === 'b' && rim);
      const color = active ? STELLAR[1] : STELLAR[0];
      const light: Brightness = active ? 1 : rim ? .5 : .25;
      const radius: DotRadius = active ? .46 : .28;
      dot(ctx, CENTER + x, CENTER + y, pitch * radius, color, light);
    }
  }
}

function field(ctx: CanvasRenderingContext2D, pitch: number, columns: number, variant: DotsVariant,
  bodies: readonly Body[] = BODIES, dynamic = false, bright = false): void {
  const wavefronts = [42, 69, 102, 138, 176, 219, 270, 324];
  for (let row = 0; row < columns; row++) {
    for (let col = 0; col < columns; col++) {
      const x = (col + .5) * pitch;
      const y = (row + .5) * pitch;
      let pullX = 0;
      let pullY = 0;
      for (const body of bodies) {
        const dx = body.x - x;
        const dy = body.y - y;
        const distance = Math.max(pitch, Math.hypot(dx, dy));
        const radius = body.radius ?? RADIUS[body.tier]!;
        const pull = Math.min(.4, radius * radius / (distance * distance) * .22);
        pullX += dx / distance * pull;
        pullY += dy / distance * pull;
      }
      const magnitude = Math.max(1, Math.hypot(pullX, pullY) / .6);
      const px = x + pitch * pullX / magnitude;
      const py = y + pitch * pullY / magnitude;
      const ringDistance = Math.hypot(x - IMPACT.x, y - IMPACT.y);
      const angle = Math.atan2(y - IMPACT.y, x - IMPACT.x);
      const band = wavefronts.findIndex((distance, index) =>
        Math.abs(ringDistance - distance - Math.sin(angle * 3 + index * .45) * 3) <= (index < 4 ? 4.1 : 3));
      if (!dynamic && variant === 'c' && band >= 0) {
        const strong = band < 4 || Math.cos(angle * 2 - .9) > .1;
        const color = band < 2 ? STELLAR[3] : band < 4 ? STELLAR[4] : STELLAR[6];
        dot(ctx, px, py, pitch * (strong ? .55 : .28), color, strong ? .8 : .25);
      } else {
        dot(ctx, px, py, pitch * .18, DUST, bright || !dynamic && variant === 'c' ? .25 : .07);
      }
    }
  }
}

function guide(ctx: CanvasRenderingContext2D, gameRadius: number, pitch: number, color: string, light: Brightness): void {
  const radius = gameRadius / BOARD_SIZE * BOARD;
  const count = Math.round(TAU * radius / (pitch * 2));
  for (let index = 0; index < count; index++) {
    const angle = TAU * index / count;
    if (gameRadius === LIMIT_RADIUS) {
      dot(ctx, CENTER + Math.cos(angle) * radius, CENTER + Math.sin(angle) * radius, pitch * .46, BACKGROUND, 1);
    }
    dot(ctx, CENTER + Math.cos(angle) * radius, CENTER + Math.sin(angle) * radius, pitch * .18, color, light);
  }
}

function contact(ctx: CanvasRenderingContext2D, pitch: number, variant: DotsVariant): void {
  const strands = variant === 'c' ? 14 : variant === 'b' ? 6 : 4;
  const steps = variant === 'c' ? 22 : 6;
  for (let strand = 0; strand < strands; strand++) {
    const angle = TAU * strand / strands + Math.sin(strand * 12.4) * .17;
    for (let index = 0; index < steps; index++) {
      const t = index / steps;
      const distance = 3 + index * pitch * (variant === 'c' ? 3.5 : 1.18) * (1 + Math.sin(strand * 5.17) * .26);
      const ray = angle + t * .17 * Math.cos(strand * 2.1);
      const x = IMPACT.x + Math.cos(ray) * distance;
      const y = IMPACT.y + Math.sin(ray) * distance;
      // 接点の近くにだけ光を重ね、6体の輪郭を追えるように外へ逃がす。
      if (distance > pitch * 1.75 &&
          BODIES.some(body => Math.hypot(x - body.x, y - body.y) <= RADIUS[body.tier]! + pitch)) continue;
      if (Math.hypot(x - CENTER, y - CENTER) < 27) continue;
      const color = t < .3 ? STELLAR[4] : t < .7 ? STELLAR[2] : STELLAR[6];
      const size = variant === 'c' ? Math.max(.28, 1.08 - t) : .28;
      dot(ctx, x, y, pitch * size, color, t < .42 ? 1 : t < .72 ? .8 : .5);
    }
  }
  dot(ctx, IMPACT.x, IMPACT.y, pitch * (variant === 'c' ? 1.22 : .46), STELLAR[4], 1);
}

export function paintDotsBoard(canvas: HTMLCanvasElement, variant: DotsVariant): void {
  const columns = variant === 'a' ? 64 : 80;
  const pitch = BOARD / columns;
  const ctx = context(canvas, BOARD, BOARD);
  field(ctx, pitch, columns, variant);
  guide(ctx, LAUNCH_RADIUS, pitch, DUST, .25);
  guide(ctx, LIMIT_RADIUS, pitch, INK, variant === 'c' ? 1 : .5);
  ctx.globalAlpha = 1;
  ctx.font = '10px Yu Gothic UI, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(58, 263, 24, 14);
  ctx.fillStyle = LABEL;
  ctx.fillText('限界', 60, 274);
  star(ctx, pitch, variant);
  for (const body of BODIES) planet(ctx, body, pitch, variant);
  contact(ctx, pitch, variant);
  ctx.globalAlpha = 1;
}

export function paintDotsQueue(canvas: HTMLCanvasElement, variant: DotsVariant): void {
  const ctx = context(canvas, 342, 60);
  const tiers = [0, 1, 2] as const;
  for (const [index, tier] of tiers.entries()) {
    const x = 57 + index * 114;
    planet(ctx, { x, y: 20, tier }, 3, variant, 10 + index * 2);
    ctx.globalAlpha = 1;
    ctx.fillStyle = LABEL;
    ctx.font = '12px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`TIER ${tier}`, x, 49);
  }
}

export function paintMovingDotsBoard(
  canvas: HTMLCanvasElement,
  variant: DotsVariant,
  snapshot: GameSnapshot,
  bodies: readonly BodyView[],
  impacts: readonly DotsImpact[],
  elapsed: number,
  reduced: boolean,
): void {
  const columns = variant === 'a' ? 64 : 80;
  const pitch = BOARD / columns;
  const ctx = context(canvas, BOARD, BOARD);
  const scale = BOARD / BOARD_SIZE;
  const views = bodies.map(body => ({
    x: CENTER + body.x * scale,
    y: CENTER + body.y * scale,
    radius: body.radius * scale,
    tier: body.tier,
    angle: reduced ? 0 : Math.sin(body.id * 1.9) + elapsed * .17,
  }));
  const latest = impacts.at(-1);
  field(ctx, pitch, columns, variant, views, true, Boolean(latest && latest.age < .48));
  for (const impact of impacts) drawDotsImpact(ctx, impact, pitch, reduced, STELLAR);
  guide(ctx, LAUNCH_RADIUS, pitch, DUST, .25);
  guide(ctx, LIMIT_RADIUS, pitch, snapshot.overLimit ? STELLAR[0] : INK, .8);
  star(ctx, pitch, variant, snapshot.heat / HEAT_MAX, CORE_RADIUS * scale);
  for (const body of views) planet(ctx, body, pitch, variant, body.radius);
  if (latest) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.font = `700 ${18 + (latest.event.chain ?? 1) * 4}px "Yu Gothic UI",sans-serif`;
    ctx.fillText(`${latest.event.chain}連鎖`, CENTER, 309);
    ctx.font = '13px Consolas,monospace';
    ctx.fillStyle = STELLAR[3];
    ctx.fillText(`+${latest.event.scoreDelta?.toLocaleString('ja-JP')}`, CENTER, 330);
  }
  ctx.globalAlpha = 1;
}
