import { BOARD_SIZE, CORE_RADIUS } from '../game/constants';
import { juiceEnvelope, type JuiceBurst } from './juice-model';

function random(seed: number, i: number): number {
  const n = Math.sin(seed * 9.7 + i * 71.3) * 43758.5453;
  return n - Math.floor(n);
}

/** 大きい出来事だけ、盤面の空間も内へ引かれてから解放される。 */
export function drawJuiceAtmosphere(ctx: CanvasRenderingContext2D, burst: JuiceBurst, time: number): void {
  if (burst.chain < 3 && !burst.supernova && burst.sourceTier < 6) return;
  const peak = burst.chain >= 5 || burst.supernova;
  ctx.save();
  // ㉗ 背景の沈み。天体とガイドは後で戻す。
  ctx.globalAlpha *= .58 * juiceEnvelope(time, 0, .09, .7);
  ctx.fillStyle = '#02040a'; ctx.fillRect(-BOARD_SIZE/2, -BOARD_SIZE/2, BOARD_SIZE, BOARD_SIZE); ctx.restore();
  // ㉘ 星の引き流れ。同じ放射粒を増やさず、遠景に長い曲線を引く。
  ctx.save(); ctx.globalAlpha *= .8 * juiceEnvelope(time, .02, .12, .8);
  ctx.strokeStyle = '#fff2d8'; ctx.lineWidth = peak ? 2 : 1;
  const pull = 1 - Math.exp(-Math.max(0, time - .04) * 6);
  for (let i = 0; i < (peak ? 22 : 10); i++) {
    const angle = burst.angle+(i%2)*Math.PI+(random(burst.seed,i)-.5)*1.1, radius = 230 + random(burst.seed, i + 90) * 200;
    const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
    const inward = (peak ? 90 : 28) * pull;
    const endX = x + (burst.x - x) / 500 * inward, endY = y + (burst.y - y) / 500 * inward;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.quadraticCurveTo((x+endX)*.5,(y+endY)*.5,endX,endY);ctx.stroke();
  }
  ctx.restore();
  // ㉟ 核のコロナだけが反対へ振れる。核本体の座標は動かさない。
  if (!peak) return;
  ctx.save(); ctx.globalAlpha *= juiceEnvelope(time, .1, .18, .65);
  ctx.strokeStyle = '#ffe3a0'; ctx.lineWidth = 7;
  const offset = Math.sin((time - .1) * 20) * Math.exp(-Math.max(0, time - .1) * 5) * 3;
  ctx.beginPath(); ctx.arc(-Math.cos(burst.angle) * offset, -Math.sin(burst.angle) * offset, CORE_RADIUS + 13, burst.angle + 2.5, burst.angle + 3.7); ctx.stroke();
  ctx.restore();
}
