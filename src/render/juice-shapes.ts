import { CHAIN_MULT_MAX, CHAIN_STEP, CORE_RADIUS, TIER_RADIUS } from '../game/constants';
import { drawBody } from './bodies';
import { juiceEnvelope, type JuiceBurst } from './juice-model';

const TAU=Math.PI*2;
const AMBER='#f5ab42';
const LIGHT='#fff2d8';
const SHADE='#172022';
const SCHEDULE=[
  [0,.03,.15],[0,.04,.12],[.045,.065,.18],[.065,.12,.48],[.08,.12,.5],
  [.09,.13,1.1],[.1,.2,.85],[.08,.12,.65],[.14,.24,.9],[.25,.5,1.4],
  [.08,.16,.7],[.15,.2,.85],[.25,.35,1.25],[.08,.12,.6],[.35,.5,1.45],
  [.06,.09,.32],[.08,.16,.5],[.18,.25,1.4],[.27,.34,1.45],[.1,.18,.6],
] as const;
function disk(ctx:CanvasRenderingContext2D,x:number,y:number,r:number):void {ctx.beginPath();ctx.arc(x,y,r,0,TAU);}
function polygon(ctx:CanvasRenderingContext2D,points:readonly (readonly number[])[]):void {
  ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x!,y!):ctx.moveTo(x!,y!));ctx.closePath();
}
function random(seed:number,index:number):number {const v=Math.sin(seed*1.71+index*79.13)*43758.5453;return v-Math.floor(v);}

/** 一つの出来事だけを描く。盤面の状態や得点を更新しない。 */
export function drawJuice(ctx:CanvasRenderingContext2D,burst:JuiceBurst,age:number,reduced=false):void {
  const chain=Math.min(5,burst.chain);const peak=burst.supernova||chain>=5;
  const strength=1+(chain-1)*.3+burst.tier*.075+(burst.supernova?.8:0);
  const echo=burst.direction==='echo';const jet=burst.direction==='jet';
  const time=reduced?.28:age/(echo?1.6:jet?.82:1);
  const travel=Math.max(0,time-.08);
  const reach=(1-Math.exp(-travel*5))*105*strength;
  const seed=burst.seed;const born=TIER_RADIUS[burst.tier];
  const rotation=jet?Math.atan2(burst.y,burst.x)+Math.PI/2:burst.angle;
  ctx.save();ctx.translate(burst.x,burst.y);
  for(let layer=0;layer<SCHEDULE.length;layer++) {
    const [start,crest,end]=SCHEDULE[layer]!;const weight=juiceEnvelope(time,start,crest,end);
    if(weight<=0)continue;
    ctx.save();ctx.globalAlpha*=weight*(reduced?Math.max(0,1-age/.9):1);ctx.fillStyle=AMBER;ctx.strokeStyle=LIGHT;ctx.lineWidth=2;
    const direction=(index:number,count:number)=>rotation+(jet?(index%2?Math.PI:0)+(random(seed,index)-.5)*.55:index/count*TAU+(random(seed,index)-.5)*.3);
    switch(layer) {
      case 0: // 外から内へ流れ、爆発前の向きを反転させる。
        for(let i=0;i<9;i++){const a=direction(i,9),r=(1-time/.16)*75*strength;ctx.beginPath();ctx.moveTo(Math.cos(a)*(r+25),Math.sin(a)*(r+25));ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);ctx.stroke();}break;
      case 1: ctx.fillStyle=SHADE;ctx.save();ctx.rotate(rotation);ctx.scale(1-time*4,1+time*2);disk(ctx,0,0,born*1.5);ctx.fill();ctx.restore();break;
      case 2: ctx.fillStyle=LIGHT;disk(ctx,0,0,(12+born*.5)*strength);ctx.fill();break;
      case 3:
        for(const side of [-1,1]){ctx.save();ctx.rotate(rotation);ctx.translate(side*reach*.5,0);polygon(ctx,[[0,-born*1.5],[side*28,0],[0,born*1.5],[-side*7,0]]);ctx.fill();ctx.restore();}break;
      case 4:
        ctx.lineWidth=5;ctx.strokeStyle=AMBER;ctx.beginPath();
        for(let i=0;i<=18;i++){const a=i/18*TAU,r=reach*(echo?(i%3===0?1.5:.8):(.87+random(seed,i)*.19));i?ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r):ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r);}ctx.stroke();break;
      case 5:
        {const count=peak?36:12;for(let i=0;i<count;i++){const a=direction(i,count),r=reach*(echo?.35:1)*(.5+random(seed,i)*.9),s=(peak?10:5)+random(seed,i+2)*(peak?19:9);ctx.save();ctx.translate(Math.cos(a)*r,Math.sin(a)*r);ctx.rotate(a+travel*3);polygon(ctx,[[-s*strength,-s*.3],[s*.7,-s*.5],[s*.2,s*strength]]);ctx.fill();ctx.restore();}}break;
      case 6:
        ctx.fillStyle=LIGHT;for(let i=0;i<6;i++){const a=direction(i,6),r=reach*.65;ctx.beginPath();ctx.ellipse(Math.cos(a)*r,Math.sin(a)*r,3,8,a,0,TAU);ctx.fill();}break;
      case 7:
        for(let i=0;i<20;i++){const a=direction(i,20),r=reach*(1+random(seed,i)*.7);ctx.beginPath();ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r);ctx.lineTo(Math.cos(a)*(r+9),Math.sin(a)*(r+9));ctx.stroke();}break;
      case 8:
        for(let i=0;i<3;i++){const a=rotation+i/3*TAU;ctx.beginPath();ctx.arc(Math.cos(a)*reach*.35,Math.sin(a)*reach*.35,reach*.55,a,a+1.4);ctx.stroke();}break;
      case 9:
        for(let i=0;i<18;i++){const a=direction(i,18),p=reach*(.5+random(seed,i));const x=Math.cos(a)*p-burst.x*travel*.25,y=Math.sin(a)*p-burst.y*travel*.25;disk(ctx,x,y,1.8);ctx.fill();}break;
      case 10:
        ctx.globalAlpha*=.2;ctx.save();ctx.rotate(rotation);polygon(ctx,[[0,0],[reach*1.7,-reach*.32],[reach*1.3,reach*.3]]);ctx.fill();ctx.restore();break;
      case 11: ctx.fillStyle=SHADE;disk(ctx,0,0,born*.8);ctx.fill();break;
      case 12:
        ctx.lineWidth=1;ctx.strokeStyle=AMBER;for(let i=-3;i<=3;i++){ctx.beginPath();ctx.moveTo(-28+i*7,28);ctx.lineTo(i*7+12,7);ctx.stroke();}break;
      case 13:
        for(let i=0;i<5;i++){const a=direction(i,5);ctx.save();ctx.rotate(a);ctx.beginPath();ctx.moveTo(born,0);ctx.lineTo(reach*.5,7);ctx.lineTo(reach*.7,-4);ctx.lineTo(reach,3);ctx.stroke();ctx.restore();}break;
      case 14:
        ctx.globalAlpha*=.18;ctx.fillStyle=AMBER;for(let i=0;i<4;i++){const a=direction(i,4);disk(ctx,Math.cos(a)*reach*.5,Math.sin(a)*reach*.5,20+travel*18);ctx.fill();}break;
      case 15:
        ctx.fillStyle=LIGHT;ctx.save();ctx.rotate(rotation);polygon(ctx,[[-reach*1.6,0],[-8,-3],[reach*1.4,-7],[reach*.7,3],[-8,6]]);ctx.fill();ctx.restore();break;
      case 16: drawBody(ctx,burst.tier,0,0,born*(.82+.22*Math.sin(time*10)),{seed});break;
      case 17:
        ctx.fillStyle=LIGHT;ctx.font=`900 ${22+chain*6}px system-ui, sans-serif`;ctx.textAlign='center';ctx.strokeStyle=SHADE;ctx.lineWidth=7;
        ctx.strokeText(`+${burst.score.toLocaleString('ja-JP')}`,0,-born-30-time*28);ctx.fillText(`+${burst.score.toLocaleString('ja-JP')}`,0,-born-30-time*28);break;
      case 18:
        ctx.fillStyle=AMBER;ctx.font=`900 ${18+chain*4}px system-ui, sans-serif`;ctx.textAlign='left';ctx.save();ctx.translate(born+20,30-time*10);ctx.rotate(-.12);ctx.fillText(`×${Math.min(CHAIN_MULT_MAX,1+CHAIN_STEP*(burst.chain-1)).toFixed(1)}`,0,0);ctx.restore();break;
      case 19:
        ctx.strokeStyle=AMBER;ctx.lineWidth=5;ctx.beginPath();ctx.arc(-burst.x,-burst.y,CORE_RADIUS+6,Math.atan2(burst.y,burst.x)-.65,Math.atan2(burst.y,burst.x)+.65);ctx.stroke();break;
    }
    ctx.restore();
  }
  // 段が上がると、粒を増やす代わりに画面を占める別の形を足す。
  if(chain>=2){ctx.globalAlpha*=juiceEnvelope(time,.22,.3,1.5);ctx.fillStyle=AMBER;ctx.font=`900 ${52+chain*14}px system-ui, sans-serif`;ctx.textAlign='right';ctx.fillText(String(chain),-born-35,born+70);}
  if(chain>=3||peak){ctx.save();ctx.globalAlpha=.28*juiceEnvelope(time,.12,.25,1);ctx.strokeStyle=AMBER;ctx.lineWidth=10;ctx.beginPath();ctx.moveTo(-burst.x,-burst.y);ctx.quadraticCurveTo(-burst.x*.4,reach*2,0,0);ctx.stroke();ctx.restore();}
  if(chain>=4||peak){ctx.save();ctx.globalAlpha=.18*juiceEnvelope(time,.1,.22,.8);ctx.fillStyle=AMBER;for(let i=0;i<3;i++){ctx.save();ctx.rotate(rotation+i/3*TAU);polygon(ctx,[[reach,-20],[reach*2.5,-70],[reach*1.9,55],[reach,20]]);ctx.fill();ctx.restore();}ctx.restore();}
  if(peak){ctx.save();ctx.globalAlpha=.5*juiceEnvelope(time,.08,.15,.65);ctx.strokeStyle=LIGHT;ctx.lineWidth=8;for(const side of [-1,1]){ctx.beginPath();ctx.moveTo(side*360-burst.x,-180-burst.y);ctx.lineTo(side*390-burst.x,-60-burst.y);ctx.lineTo(side*360-burst.x,180-burst.y);ctx.stroke();}ctx.restore();}
  ctx.restore();
}
