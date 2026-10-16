// 題目2の小粒子。小さい表示でも残る白い一面を、刻線より先に描く。
export type GrainVariant = 'compact' | 'aggregate' | 'shard';
const INK = '#202923';
const PAPER = '#f1ead8';
const TAU = Math.PI * 2;

export function drawGrain(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, variant: GrainVariant = 'compact'): void {
  ctx.save(); ctx.translate(x, y); ctx.scale(radius, radius);
  ctx.fillStyle = INK; ctx.strokeStyle = PAPER; ctx.lineWidth = 0.045;
  ctx.beginPath();
  if (variant === 'aggregate') {
    for (const [cx, cy] of [[-0.3,0.24],[0.3,0.2],[0,-0.32]]) { ctx.moveTo(cx! + 0.59, cy!); ctx.arc(cx!, cy!, 0.59, 0, TAU); }
  } else if (variant === 'shard') {
    ctx.moveTo(-0.92,-0.24); ctx.lineTo(-0.13,-0.95); ctx.lineTo(0.83,-0.48);
    ctx.lineTo(0.7,0.63); ctx.lineTo(-0.42,0.88); ctx.closePath();
  } else ctx.arc(0, 0, 0.975, 0, TAU);
  if (variant === 'aggregate') { ctx.stroke(); ctx.fill(); }
  else { ctx.fill(); ctx.stroke(); }
  ctx.fillStyle = PAPER;
  if (variant === 'aggregate') {
    for (const [cx, cy] of [[-0.4,0.15],[0.2,0.04],[-0.1,-0.44]]) { ctx.beginPath(); ctx.ellipse(cx!, cy!, 0.2, 0.12, -0.6, 0, TAU); ctx.fill(); }
  } else if (variant === 'shard') {
    ctx.beginPath(); ctx.moveTo(-0.81,-0.2); ctx.lineTo(-0.13,-0.8); ctx.lineTo(0.26,-0.38); ctx.lineTo(-0.4,0.23); ctx.closePath(); ctx.fill();
  } else {
    ctx.beginPath(); ctx.moveTo(-0.76,-0.27);
    ctx.bezierCurveTo(-0.58,-0.73,-0.06,-0.83,0.25,-0.57);
    ctx.bezierCurveTo(-0.05,-0.38,-0.24,-0.03,-0.58,0.13);
    ctx.quadraticCurveTo(-0.8,0.02,-0.76,-0.27); ctx.fill();
    // 下側の一面も28pxで残す。細線を縮小に任せない。
    ctx.beginPath(); ctx.moveTo(0.56,0.1); ctx.lineTo(0.67,0.32);
    ctx.quadraticCurveTo(0.5,0.68,0.12,0.72); ctx.lineTo(0.32,0.51); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

const compactImages = new Map<number, HTMLCanvasElement>();
export function drawCachedGrain(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  const size = radius <= 20 ? 64 : 512;
  let compactImage = compactImages.get(size);
  if (!compactImage) {
    // 小粒には小さな画像を使い、512pxからの毎回の縮小を省く。
    compactImage = document.createElement('canvas'); compactImage.width = size; compactImage.height = size;
    drawGrain(compactImage.getContext('2d')!,size / 2,size / 2,size / 2); compactImages.set(size,compactImage);
  }
  ctx.drawImage(compactImage,x-radius,y-radius,radius*2,radius*2);
}
