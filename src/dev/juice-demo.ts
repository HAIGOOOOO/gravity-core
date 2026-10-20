import '../styles/juice.css';
import type { GameEvent, Tier } from '../contracts/game';
import { BOARD_SIZE, DPR_CAP, LAUNCH_RADIUS, LIMIT_RADIUS, MAX_FRAME_SECONDS } from '../game/constants';
import { dropAt, sampleEvent, setupAllTiers } from '../fixtures';
import { createSimulation } from '../game/simulation';
import { createBoardRenderer } from '../render';
import { drawJuice } from '../render/juice-shapes';
import { juiceDuration, makeJuiceBurst, type JuiceBurst, type JuiceDirection } from '../render/juice-model';

const board=document.getElementById('juice-board') as HTMLCanvasElement;
const effects=document.getElementById('juice-effects') as HTMLCanvasElement;
const ctx=effects.getContext('2d')!;
const renderer=createBoardRenderer(board);
const stage=document.querySelector<HTMLElement>('.juice-stage')!;
const status=document.getElementById('juice-status')!;
const bar=document.getElementById('demo-controls')!;
const slider=document.getElementById('juice-time') as HTMLInputElement;
const reduced=document.getElementById('juice-reduced') as HTMLInputElement;
const sim=createSimulation(13,setupAllTiers());
const snapshot=sim.getSnapshot();const prediction=sim.predict(dropAt(-Math.PI/2));
const names:Record<JuiceDirection,string>={fracture:'A 圧縮して割れる',jet:'B 一方向へ噴き出す',echo:'C 遅れて余響が広がる'};
let direction:JuiceDirection='fracture';let event:GameEvent=sampleEvent('merge',2,135,-100,3);
let burst=makeJuiceBurst(event,direction)!;let age=0;let paused=false;let previous=performance.now();
function button(name:string,action:()=>void,key?:JuiceDirection):void {
  const b=document.createElement('button');b.type='button';b.textContent=name;
  if(key)b.dataset.direction=key;
  b.addEventListener('click',action);bar.append(b);
}
function announce():void {
  document.getElementById('direction-name')!.textContent=names[direction];
  status.textContent=`${burst.supernova?'超新星':`${burst.chain}連鎖`}・${age>juiceDuration(burst)?'再生終了':paused?'静止比較':'再生中'}。演出の見本です。`;
  bar.querySelectorAll<HTMLElement>('[data-direction]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.direction===direction)));
}
function fire(chain:number,tier:Tier=2,nova=false):void {
  event=sampleEvent(nova?'supernova':'merge',tier,135,-100,chain);burst=makeJuiceBurst(event,direction)!;age=0;paused=false;announce();
}
for(const key of Object.keys(names) as JuiceDirection[])button(names[key],()=>{direction=key;burst=makeJuiceBurst(event,direction)!;age=0;paused=false;announce();},key);
for(let chain=1;chain<=5;chain++)button(`${chain}連鎖`,()=>fire(chain));
button('巨大惑星の合体',()=>fire(1,6));button('超新星',()=>fire(5,8,true));
button('3案を並べる',compare);
button('時系列を並べる',timeline);
button('止めて比べる',()=>{paused=true;age=Number(slider.value)/1000;announce();});
button('再生',()=>{age=0;paused=false;announce();});
button('描画時間を測る',measure);
slider.addEventListener('input',()=>{paused=true;age=Number(slider.value)/1000;document.getElementById('juice-time-label')!.textContent=`${age.toFixed(2)}秒`;announce();});
for(const seconds of [.04,.1,.28,.8]){
  const b=document.createElement('button');b.type='button';b.textContent=`${seconds.toFixed(2)}秒`;
  b.addEventListener('click',()=>{paused=true;age=seconds;slider.value=String(seconds*1000);document.getElementById('juice-time-label')!.textContent=`${seconds.toFixed(2)}秒`;announce();});document.getElementById('juice-times')!.append(b);
}

function foreground(target:CanvasRenderingContext2D):void {
  // 成功の演出より、実際の予測と限界を上へ戻す。操作を推測して作らない。
  target.save();target.globalCompositeOperation='destination-out';target.lineWidth=22;
  target.beginPath();prediction.points.forEach((p,i)=>i?target.lineTo(p.x,p.y):target.moveTo(p.x,p.y));target.stroke();
  target.beginPath();target.arc(0,0,LIMIT_RADIUS,0,Math.PI*2);target.lineWidth=18;target.stroke();target.restore();
  target.strokeStyle=snapshot.overLimit?'#ff7d83':'#c8d0c5';target.lineWidth=2;target.setLineDash([10,8]);
  target.beginPath();target.arc(0,0,LIMIT_RADIUS,0,Math.PI*2);target.stroke();target.setLineDash([]);
  target.fillStyle='#fff2d8';for(const point of prediction.points){target.beginPath();target.arc(point.x,point.y,3,0,Math.PI*2);target.fill();}
  target.beginPath();target.arc(0,-LAUNCH_RADIUS,12,0,Math.PI*2);target.stroke();
}
function paint(target:CanvasRenderingContext2D,item:JuiceBurst,seconds:number):void {
  drawJuice(target,item,seconds,reduced.checked);foreground(target);
}
function resize():void {
  const size=stage.clientWidth;renderer.resize(size);const pixels=Math.round(size*Math.min(devicePixelRatio,DPR_CAP));effects.width=pixels;effects.height=pixels;
}
new ResizeObserver(resize).observe(stage);resize();
function frame(now:number):void {
  const dt=Math.min((now-previous)/1000,MAX_FRAME_SECONDS);previous=now;if(!paused){age+=dt;if(age>juiceDuration(burst)){paused=true;announce();}}
  renderer.draw({prev:snapshot,curr:snapshot,alpha:1,timeSeconds:0,aim:null,reducedMotion:reduced.checked,aimGuide:true,dimmed:false});
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,effects.width,effects.height);
  const scale=effects.width/BOARD_SIZE;ctx.setTransform(scale,0,0,scale,effects.width/2,effects.height/2);
  if(age<=juiceDuration(burst))paint(ctx,burst,age);else foreground(ctx);
  requestAnimationFrame(frame);
}
function compare():void {
  const out=document.getElementById('juice-frames')!;out.replaceChildren();document.getElementById('juice-comparison')!.hidden=false;
  for(const key of Object.keys(names) as JuiceDirection[]){
    const figure=document.createElement('figure');const canvas=document.createElement('canvas');canvas.width=480;canvas.height=480;
    const r=createBoardRenderer(canvas);r.resize(480);r.draw({prev:snapshot,curr:snapshot,alpha:1,timeSeconds:0,aim:null,reducedMotion:false,aimGuide:true,dimmed:false});
    const overlay=document.createElement('canvas');overlay.width=canvas.width;overlay.height=canvas.height;const context=overlay.getContext('2d')!;const s=overlay.width/BOARD_SIZE;context.setTransform(s,0,0,s,overlay.width/2,overlay.height/2);
    paint(context,makeJuiceBurst(event,key)!,Number(slider.value)/1000);composite(canvas,overlay);
    canvas.style.width='100%';canvas.style.height='auto';
    const caption=document.createElement('figcaption');caption.textContent=names[key];figure.append(canvas,caption);out.append(figure);
  }
}
function timeline():void {
  const out=document.getElementById('juice-frames')!;out.replaceChildren();document.getElementById('juice-comparison')!.hidden=false;
  for(const chain of [1,3,5]){
    const figure=document.createElement('figure');figure.style.gridColumn='1/-1';const strip=document.createElement('canvas');strip.width=960;strip.height=240;const context=strip.getContext('2d')!;
    const item=makeJuiceBurst(sampleEvent('merge',2,135,-100,chain),direction)!;
    for(const [index,seconds] of [.04,.1,.28,.8].entries()){
      const tile=document.createElement('canvas');const render=createBoardRenderer(tile);render.resize(240);render.draw({prev:snapshot,curr:snapshot,alpha:1,timeSeconds:0,aim:null,reducedMotion:false,aimGuide:true,dimmed:false});
      const overlay=document.createElement('canvas');overlay.width=tile.width;overlay.height=tile.height;const drawing=overlay.getContext('2d')!;const scale=overlay.width/BOARD_SIZE;drawing.setTransform(scale,0,0,scale,overlay.width/2,overlay.height/2);
      paint(drawing,item,seconds);composite(tile,overlay);context.drawImage(tile,index*240,0,240,240);
    }
    const caption=document.createElement('figcaption');caption.textContent=`${chain}連鎖：左から0.04 / 0.10 / 0.28 / 0.80秒`;figure.append(strip,caption);out.append(figure);
  }
}
function composite(base:HTMLCanvasElement,overlay:HTMLCanvasElement):void {
  // 盤面の描画後は論理座標の変換が残る。画像の合成には物理ピクセルを使う。
  const context=base.getContext('2d')!;context.save();context.setTransform(1,0,0,1,0,0);context.drawImage(overlay,0,0);context.restore();
}
function measure():void {
  const canvas=document.createElement('canvas');canvas.width=BOARD_SIZE;canvas.height=BOARD_SIZE;const context=canvas.getContext('2d')!;const samples:number[]=[];
  for(let i=0;i<360;i++){context.setTransform(1,0,0,1,BOARD_SIZE/2,BOARD_SIZE/2);const start=performance.now();context.clearRect(-BOARD_SIZE/2,-BOARD_SIZE/2,BOARD_SIZE,BOARD_SIZE);paint(context,burst,(i%120)/60);if(i>=120)samples.push(performance.now()-start);}
  samples.sort((a,b)=>a-b);document.getElementById('juice-performance')!.textContent=`${burst.supernova?'超新星':`${burst.chain}連鎖`}・240コマのCPU描画：95% ${samples[Math.ceil(samples.length*.95)-1]!.toFixed(2)}ms、最大 ${samples.at(-1)!.toFixed(2)}ms。40層以上への追加と動画審査は未完です。`;
}
announce();requestAnimationFrame(frame);
