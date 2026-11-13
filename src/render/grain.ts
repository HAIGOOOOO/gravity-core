// 題目2の小粒子。小さい表示でも残る白い一面を、刻線より先に描く。
import { TIER_COLOR } from '../game/constants';
import { grainPose, grainResolution } from './grain-detail';

export type GrainVariant = 'compact' | 'aggregate' | 'shard';
const INK = '#202923';
const PAPER = '#f1ead8';
const TAU = Math.PI * 2;

export function drawGrain(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, variant: GrainVariant = 'compact', night = false, variation = 0): void {
  ctx.save(); ctx.translate(x, y); ctx.scale(radius, radius);
  ctx.fillStyle = night ? TIER_COLOR[0] : INK; ctx.strokeStyle = night ? '#c4efff' : PAPER; ctx.lineWidth = 0.045;
  ctx.beginPath();
  if (variant === 'aggregate') {
    for (const [cx, cy] of [[-0.3,0.24],[0.3,0.2],[0,-0.32]]) { ctx.moveTo(cx! + 0.59, cy!); ctx.arc(cx!, cy!, 0.59, 0, TAU); }
  } else if (variant === 'shard') {
    ctx.moveTo(-0.92,-0.24); ctx.lineTo(-0.13,-0.95); ctx.lineTo(0.83,-0.48);
    ctx.lineTo(0.7,0.63); ctx.lineTo(-0.42,0.88); ctx.closePath();
  } else ctx.arc(0, 0, 0.975, 0, TAU);
  if (variant === 'aggregate') { ctx.stroke(); ctx.fill(); }
  else { ctx.fill(); ctx.stroke(); }
  ctx.fillStyle = night ? '#254b64' : PAPER;
  if (variant === 'aggregate') {
    for (const [cx, cy] of [[-0.4,0.15],[0.2,0.04],[-0.1,-0.44]]) { ctx.beginPath(); ctx.ellipse(cx!, cy!, 0.2, 0.12, -0.6, 0, TAU); ctx.fill(); }
  } else if (variant === 'shard') {
    ctx.beginPath(); ctx.moveTo(-0.81,-0.2); ctx.lineTo(-0.13,-0.8); ctx.lineTo(0.26,-0.38); ctx.lineTo(-0.4,0.23); ctx.closePath(); ctx.fill();
  } else {
    ctx.beginPath(); ctx.moveTo(-0.76,-0.27);
    ctx.bezierCurveTo(-0.58,-0.73,-0.06,-0.83,0.21 + variation * 0.04,-0.57);
    ctx.bezierCurveTo(-0.05,-0.38,-0.24,-0.03,-0.58,0.13);
    ctx.quadraticCurveTo(-0.8,0.02,-0.76,-0.27); ctx.fill();
    // 下側の一面も28pxで残す。細線を縮小に任せない。
    ctx.beginPath(); ctx.moveTo(0.56,0.1); ctx.lineTo(0.67,0.32);
    ctx.quadraticCurveTo(0.5,0.68,0.1 + variation * 0.04,0.72); ctx.lineTo(0.32,0.51); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

const compactImages = new Map<string, HTMLCanvasElement>();
export function drawCachedGrain(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, seed = 0): void {
  const transform = ctx.getTransform();
  // Canvasの変換には端末のpixelRatioも含まれるので、二重に掛けない。
  const pixelScale = Math.max(Math.hypot(transform.a,transform.b),Math.hypot(transform.c,transform.d));
  const size = grainResolution(radius,pixelScale);
  const pose = grainPose(seed); const key = `${size}:${pose.variation}`;
  let compactImage = compactImages.get(key);
  if (!compactImage) {
    // 小粒には小さな画像を使い、512pxからの毎回の縮小を省く。
    compactImage = document.createElement('canvas'); compactImage.width = size; compactImage.height = size;
    drawGrain(compactImage.getContext('2d')!,size / 2,size / 2,size / 2,'compact',true,pose.variation); compactImages.set(key,compactImage);
  }
  ctx.save(); ctx.translate(x,y); ctx.rotate(pose.angle);
  ctx.drawImage(compactImage,-radius,-radius,radius*2,radius*2); ctx.restore();
}
