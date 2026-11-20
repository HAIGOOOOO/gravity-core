import { BOARD_SIZE } from '../game/constants';
import type { JuiceBurst } from '../render/juice-model';
import { STRINGS } from '../ui/strings';
import { IMPACT_COLORS, IMPACT_GRID, impactEnvelope, impactProfile } from './impact-model';

const TURN = Math.PI * 2, PITCH = BOARD_SIZE / IMPACT_GRID;
const MIN = -BOARD_SIZE / 2 + PITCH / 2;

function point(path: Path2D, x: number, y: number, radius: number): void {
  path.moveTo(x + radius, y); path.arc(x, y, radius, 0, TURN);
}

let grid: Path2D | undefined;
function field(): Path2D {
  if (!grid) {
    grid = new Path2D();
    for (let y = 0; y < IMPACT_GRID; y++) {
      for (let x = 0; x < IMPACT_GRID; x++) point(grid, MIN + x * PITCH, MIN + y * PITCH, PITCH * .28);
    }
  }
  return grid;
}

/** 普段は透明。事件の波が、停止した点の格子と飛び出す点を照らす。 */
export function drawImpact(ctx: CanvasRenderingContext2D, burst: JuiceBurst, age: number, reduced: boolean): void {
  const p = impactProfile(burst);
  if (age < 0 || age >= p.duration) return;
  const envelope = impactEnvelope(age, p.duration);
  ctx.save();
  if (reduced) {
    ctx.globalAlpha = .11 * envelope;
    ctx.fillStyle = p.color; ctx.fill(field());
    ctx.restore(); labels(ctx, burst, age, p.duration); return;
  }
  ctx.globalCompositeOperation = 'lighter';
  // 広い明滅は1回だけ。後から来る輪は点の列を走らせる。
  const flash = Math.exp(-Math.pow((age - .12) / .085, 2));
  ctx.fillStyle = burst.supernova ? IMPACT_COLORS[5] : p.color;
  ctx.globalAlpha = flash * (burst.supernova ? 1 : .18 + p.stage * .04);
  ctx.fill(field());

  const wave = new Path2D(), hot = new Path2D();
  for (let ring = 0; ring < p.waves; ring++) {
    const elapsed = age - .065 - ring * (burst.supernova ? .11 : .042);
    if (elapsed < 0) continue;
    const progress = Math.min(1, elapsed / (p.duration * .72));
    const radius = 12 + p.reach * progress;
    if (progress >= 1) continue;
    const count = Math.min(320, Math.max(24, Math.ceil(radius * TURN / PITCH)));
    const r = (1 - progress) * (ring === 0 ? p.pointSize * 1.5 : p.pointSize);
    for (let n = 0; n < count; n++) {
      const angle = n * TURN / count + burst.angle;
      const x = burst.x + Math.cos(angle) * radius, y = burst.y + Math.sin(angle) * radius;
      point(ring % 2 ? wave : hot, x, y, Math.max(.65, r));
      if (ring < 2) {
        point(wave, x - Math.cos(angle) * PITCH, y - Math.sin(angle) * PITCH, Math.max(.65, r * .65));
      }
    }
  }

  const sparks = new Path2D();
  const time = Math.max(0, age - .09), drag = 1 - Math.exp(-time * 2.5);
  for (let i = 0; i < p.particles; i++) {
    // 黄金角で一方向の筋と散らばりを作る。毎コマ乱数を振って点をちらつかせない。
    const angle = i * 2.39996323 + burst.angle;
    const speed = .3 + ((i * 37 + burst.seed) % 101) / 101;
    const distance = drag * p.reach * speed;
    const x = burst.x + Math.cos(angle) * distance, y = burst.y + Math.sin(angle) * distance;
    const size = p.pointSize * (.4 + speed) * envelope;
    point(sparks, x, y, size);
    if (p.stage >= 3 || burst.supernova) {
      point(sparks, x - Math.cos(angle) * (10 + time * 30), y - Math.sin(angle) * (10 + time * 30), size * .45);
    }
  }
  ctx.globalAlpha = envelope * .85; ctx.fillStyle = p.color; ctx.fill(wave); ctx.fill(sparks);
  ctx.globalAlpha = envelope; ctx.fillStyle = IMPACT_COLORS[5]; ctx.fill(hot);

  // 接点の白い芯は点の塊で作る。事件の時だけ光のにじみを許す。
  const flare = new Path2D();
  const collapse = Math.exp(-Math.pow((age - .1) / .13, 2));
  for (let n = 0; n < 19; n++) {
    const radius = n === 0 ? 0 : 12 + n * 1.5;
    const angle = n * 2.39996323;
    point(flare, burst.x + Math.cos(angle) * radius, burst.y + Math.sin(angle) * radius, (12 + p.stage * 2.5) * collapse);
  }
  ctx.shadowColor = p.color; ctx.shadowBlur = 24; ctx.globalAlpha = collapse;
  ctx.fill(flare); ctx.restore();
  labels(ctx, burst, age, p.duration);
}

function labels(ctx: CanvasRenderingContext2D, burst: JuiceBurst, age: number, duration: number): void {
  if (age < .12) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, (duration - age) / .3);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const x = Math.max(-280, Math.min(280, burst.x));
  const y = Math.max(-280, Math.min(270, burst.y + 95));
  ctx.strokeStyle = '#05060a'; ctx.lineWidth = 6; ctx.lineJoin = 'round';
  ctx.fillStyle = IMPACT_COLORS[5]; ctx.font = '700 34px "Yu Gothic UI", sans-serif';
  const amount = '＋' + burst.score.toLocaleString('ja-JP');
  ctx.strokeText(amount, x, y); ctx.fillText(amount, x, y);
  if (burst.chain > 1 || burst.supernova) {
    ctx.font = `700 ${burst.chain >= 5 || burst.supernova ? 48 : 30}px "Yu Gothic UI", sans-serif`;
    const text = burst.supernova ? STRINGS.effectSupernova : `${STRINGS.effectChain} ×${burst.chain}`;
    ctx.strokeText(text, x, y - 48); ctx.fillText(text, x, y - 48);
  }
  ctx.restore();
}
