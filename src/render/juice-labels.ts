import { CHAIN_MULT_MAX, CHAIN_STEP, TIER_RADIUS } from '../game/constants';
import { juiceEnvelope, type JuiceBurst } from './juice-model';

export function juiceLabelPosition(burst:JuiceBurst) {
  const crest=burst.chain>=2||burst.supernova,peak=burst.chain>=5||burst.supernova;
  return {x:crest?(peak?-190:-250):burst.x+TIER_RADIUS[burst.tier]+20,y:crest?(peak?350:365):burst.y+TIER_RADIUS[burst.tier]+38,crest,peak};
}

/** 得点と連鎖数は破片の後へ戻し、文字の下だけ余白を確保する。 */
export function drawJuiceLabels(ctx: CanvasRenderingContext2D, burst: JuiceBurst, age: number, reduced: boolean): void {
  const time = reduced ? .28 : age / (burst.direction === 'echo' ? 1.6 : burst.direction === 'jet' ? .82 : 1);
  const opacity = juiceEnvelope(time, .18, .25, 1.4) * (reduced ? Math.max(0, 1 - age / .9) : 1);
  if (opacity <= 0) return;
  const {x,y,crest:hasCrest,peak}=juiceLabelPosition(burst);
  ctx.save(); ctx.translate(x, y); ctx.globalAlpha *= opacity;
  ctx.font = '900 30px "Yu Mincho","YuMincho",serif'; ctx.textAlign = 'left';
  const score = `+${burst.score.toLocaleString('ja-JP')}`;
  const width = Math.max(ctx.measureText(score).width, burst.chain >= 2 ? 118 : 0);
  ctx.fillStyle = '#070b18'; ctx.fillRect(-8, -30, width + 16, 61);
  ctx.fillStyle = '#fff2d8'; ctx.fillText(score, 0, 0);
  ctx.fillStyle = '#f5ab42'; ctx.font = '900 22px "Yu Mincho","YuMincho",serif';
  const multiplier=`×${Math.min(CHAIN_MULT_MAX, 1 + CHAIN_STEP * (burst.chain - 1)).toFixed(1)}`;
  // ㉞ 最大の倍率だけ、活字の上下が一度割れてから同じ位置へ戻る。
  const split=burst.chain>=4||burst.supernova?juiceEnvelope(time,.18,.25,.56)*8:0;
  for(const side of [-1,1]){
    ctx.save();ctx.beginPath();ctx.rect(-12,side<0?-4:16,width+32,side<0?20:28);ctx.clip();ctx.translate(side*split,0);ctx.fillText(multiplier,0,26);ctx.restore();
  }
  ctx.restore();
  if(burst.chain<2&&!burst.supernova)return;
  ctx.save();ctx.globalAlpha*=opacity;ctx.fillStyle='#fff2d8';ctx.textAlign='left';
  const digits=['一','二','三','四','五'];
  ctx.font=`900 ${peak?170:100}px "Yu Mincho","YuMincho",serif`;
  const crest=burst.supernova?'超':digits[Math.min(5,burst.chain)-1]!;
  ctx.strokeStyle='#070b18';ctx.lineWidth=3;ctx.strokeText(crest,-370,400);ctx.fillText(crest,-370,400);
  ctx.font=`700 ${peak?42:32}px "Yu Mincho","YuMincho",serif`;ctx.fillStyle='#f5ab42';
  if(hasCrest)ctx.fillText(burst.supernova?'新星':'連鎖',x,y-(peak?50:35));
  ctx.restore();
}
