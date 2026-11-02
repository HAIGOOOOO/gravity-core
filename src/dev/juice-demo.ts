import '../styles/juice.css';
import type { GameEvent, Tier } from '../contracts/game';
import { BOARD_SIZE, DPR_CAP, DT, LAUNCH_RADIUS, LIMIT_RADIUS, MAX_FRAME_SECONDS, TIER_RADIUS } from '../game/constants';
import { createTimeGovernor } from '../shared/time';
import { dropAt } from '../fixtures';
import { createBoardRenderer } from '../render';
import { drawBody } from '../render/bodies';
import { createJuiceScene, type JuiceScene } from './juice-scene';
import { drawJuice } from '../render/juice-shapes';
import { drawJuiceLabels } from '../render/juice-labels';
import { drawJuiceMemories, drawJuiceReflections } from '../render/juice-reflections';
import { drawJuiceAtmosphere } from '../render/juice-atmosphere';
import { createJuiceTiming, juiceMatterTime, juiceView } from '../render/juice-timing';
import { drawJuiceAfterimage, drawJuiceCooling, drawJuiceDeadline, drawJuiceExposure, drawJuiceShadows, drawJuiceTypeChips, juiceExposure } from '../render/juice-peak';
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
let scene=createJuiceScene(2,3);
const names:Record<JuiceDirection,string>={fracture:'A 圧縮して割れる',jet:'B 一方向へ噴き出す',echo:'C 遅れて余響が広がる'};
let direction:JuiceDirection='fracture';let event:GameEvent=scene.event;
let burst=makeJuiceBurst(event,direction)!;let age=0;let paused=false;let previous=performance.now();
const timing=createJuiceTiming(),governor=createTimeGovernor();
let live=false,accumulator=0,appearanceSeed=0;
let stopped=0,longestStop=0,slowest=1;
const clockText=document.createElement('p');clockText.id='juice-clock';clockText.setAttribute('role','status');status.after(clockText);
function button(name:string,action:()=>void,key?:JuiceDirection):void {
  const b=document.createElement('button');b.type='button';b.textContent=name;
  if(key)b.dataset.direction=key;
  b.addEventListener('click',action);bar.append(b);
}
function announce():void {
  document.getElementById('direction-name')!.textContent=names[direction];
  status.textContent=`${burst.supernova?'超新星':`${burst.chain}連鎖`}・${age>juiceDuration(burst)?'再生終了':paused?'静止比較':'再生中'}。${live?'実計算の天体を時間の上限を通して進めています。':'演出の見本です。'}`;
  bar.querySelectorAll<HTMLElement>('[data-direction]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.direction===direction)));
}
function fire(chain:number,tier:Tier=2,nova=false):void {
  live=false;accumulator=0;stopped=0;longestStop=0;slowest=1;clockText.textContent='';governor.reset();scene=createJuiceScene(nova?8:tier,chain);event=scene.event;burst=makeJuiceBurst(event,direction,++appearanceSeed)!;timing.start(burst);age=0;paused=false;announce();
}
for(const key of Object.keys(names) as JuiceDirection[])button(names[key],()=>{direction=key;const wasLive=live;fire(burst.chain,burst.sourceTier,burst.supernova);live=wasLive;announce();},key);
for(let chain=1;chain<=5;chain++)button(`${chain}連鎖`,()=>fire(chain));
button('巨大惑星の合体',()=>fire(1,6));button('超新星',()=>fire(5,8,true));
button('実計算で巨大合体',()=>{fire(1,6);live=true;announce();});
button('実計算で超新星',()=>{fire(1,8,true);live=true;announce();});
button('3案を並べる',compare);
button('時系列を並べる',timeline);
button('止めて比べる',()=>{paused=true;age=Number(slider.value)/1000;announce();});
button('再生',()=>{const wasLive=live;fire(burst.chain,burst.sourceTier,burst.supernova);live=wasLive;announce();});
button('描画時間を測る',measure);
slider.addEventListener('input',()=>{paused=true;age=Number(slider.value)/1000;document.getElementById('juice-time-label')!.textContent=`${age.toFixed(2)}秒`;announce();});
for(const seconds of [.04,.1,.28,.8]){
  const b=document.createElement('button');b.type='button';b.textContent=`${seconds.toFixed(2)}秒`;
  b.addEventListener('click',()=>{paused=true;age=seconds;slider.value=String(seconds*1000);document.getElementById('juice-time-label')!.textContent=`${seconds.toFixed(2)}秒`;announce();});document.getElementById('juice-times')!.append(b);
}

function clearGuides(target:CanvasRenderingContext2D,current:JuiceScene):void {
  const {prediction}=current;
  // 成功の演出より、実際の予測と限界を上へ戻す。操作を推測して作らない。
  target.save();target.globalCompositeOperation='destination-out';target.lineWidth=22;
  target.beginPath();prediction.points.forEach((p,i)=>i?target.lineTo(p.x,p.y):target.moveTo(p.x,p.y));target.stroke();
  target.beginPath();target.arc(0,0,LIMIT_RADIUS,0,Math.PI*2);target.lineWidth=18;target.stroke();target.restore();
}
function foreground(target:CanvasRenderingContext2D,current:JuiceScene,item:JuiceBurst=burst,seconds:number=age):void {
  const {prediction,background:snapshot}=current;
  target.strokeStyle='#070b18';target.lineWidth=5;target.setLineDash([10,8]);
  target.beginPath();target.arc(0,0,LIMIT_RADIUS,0,Math.PI*2);target.stroke();
  target.strokeStyle=snapshot.overLimit?'#ff7d83':'#c8d0c5';target.lineWidth=2;
  target.beginPath();target.arc(0,0,LIMIT_RADIUS,0,Math.PI*2);target.stroke();target.setLineDash([]);
  target.fillStyle='#fff2d8';target.strokeStyle='#070b18';target.lineWidth=2;
  for(const point of prediction.points){target.beginPath();target.arc(point.x,point.y,3,0,Math.PI*2);target.fill();target.stroke();}
  target.beginPath();target.arc(0,-LAUNCH_RADIUS,12,0,Math.PI*2);target.strokeStyle='#070b18';target.lineWidth=5;target.stroke();target.strokeStyle='#fff2d8';target.lineWidth=2;target.stroke();
}
function subjects(target:CanvasRenderingContext2D,item:JuiceBurst,seconds:number,current:JuiceScene):void {
  const time=reduced.checked?.28:juiceMatterTime(item,seconds)/(item.direction==='echo'?1.6:item.direction==='jet'?.82:1);
  target.save();target.globalCompositeOperation='destination-out';
  for(const body of current.background.bodies){target.beginPath();target.arc(body.x,body.y,body.radius+4,0,Math.PI*2);target.fill();}
  // 誕生した天体の面を抜き、破片に輪郭が埋もれないようにする。
  if(current.result&&time>=.09){const body=current.result;target.beginPath();target.arc(body.x,body.y,TIER_RADIUS[body.tier]+5,0,Math.PI*2);target.fill();}
  target.restore();target.save();target.strokeStyle='#fff2d8';target.lineWidth=2;
  for(const body of current.background.bodies){
    const distance=Math.hypot(body.x-item.x,body.y-item.y);
    const heavy=item.chain>=4||item.supernova||item.sourceTier>=6;
    const response=!reduced.checked&&heavy&&distance<300?Math.sin(Math.max(0,time-.1)*24)*Math.exp(-Math.max(0,time-.1)*7)*.05:0;
    const angle=Math.atan2(body.y-item.y,body.x-item.x);
    target.save();target.translate(body.x,body.y);target.rotate(angle);target.scale(1-response,1/(1-response));
    drawBody(target,body.tier,0,0,body.radius,{seed:body.id});
    if(juiceExposure(item,seconds,reduced.checked)>.45){target.strokeStyle='#070b18';target.beginPath();target.arc(0,0,body.radius,0,Math.PI*2);target.stroke();}
    if(body.overLimit){target.strokeStyle='#ff7d83';target.beginPath();target.arc(0,0,body.radius+3,0,Math.PI*2);target.stroke();}
    target.restore();
  }
  if(time<.09){
    const p=Math.min(1,time/.09);
    for(const body of current.sources){
      const x=body.x+(item.x-body.x)*p*.55,y=body.y+(item.y-body.y)*p*.55,r=body.radius*(1-p*.18);
      drawBody(target,body.tier,x,y,r,{seed:body.id});target.beginPath();target.arc(x,y,r+2,0,Math.PI*2);target.stroke();
    }
  }else if(current.result){
    const body=current.result;const r=TIER_RADIUS[body.tier]*(time<.3?1+.12*Math.sin((time-.09)/.21*Math.PI):1);
    drawBody(target,body.tier,body.x,body.y,r,{seed:body.id});target.beginPath();target.arc(body.x,body.y,r+2,0,Math.PI*2);target.stroke();
  }
  target.restore();
}
function paint(target:CanvasRenderingContext2D,item:JuiceBurst,seconds:number,current:JuiceScene=scene):void {
  const time=reduced.checked?.28:seconds/(item.direction==='echo'?1.6:item.direction==='jet'?.82:1);
  target.save();if(reduced.checked)target.globalAlpha*=Math.max(0,1-seconds/.9);
  drawJuiceAtmosphere(target,item,time);target.restore();
  drawJuiceExposure(target,item,seconds,reduced.checked);
  drawJuice(target,item,seconds,reduced.checked);
  target.save();if(reduced.checked)target.globalAlpha*=Math.max(0,1-seconds/.9);
  drawJuiceMemories(target,item,current.sources,time);target.restore();
  target.save();if(reduced.checked)target.globalAlpha*=Math.max(0,1-seconds/.9);
  drawJuiceAfterimage(target,item,current.flashBodies,time);target.restore();
  clearGuides(target,current);
  subjects(target,item,seconds,current);
  target.save();if(reduced.checked)target.globalAlpha*=Math.max(0,1-seconds/.9);
  drawJuiceReflections(target,item,current.background.bodies,time);target.restore();
  target.save();if(reduced.checked)target.globalAlpha*=Math.max(0,1-seconds/.9);
  drawJuiceShadows(target,item,current.background.bodies,time);
  drawJuiceCooling(target,item,time);target.restore();
  drawJuiceDeadline(target,item,current.result,current.background,seconds,live);
  drawJuiceLabels(target,item,seconds,reduced.checked);
  target.save();if(reduced.checked)target.globalAlpha*=Math.max(0,1-seconds/.9);drawJuiceTypeChips(target,item,time);target.restore();
  foreground(target,current,item,seconds);
}
function resize():void {
  const size=stage.clientWidth;renderer.resize(size);const pixels=Math.round(size*Math.min(devicePixelRatio,DPR_CAP));effects.width=pixels;effects.height=pixels;
}
new ResizeObserver(resize).observe(stage);resize();
function frame(now:number):void {
  const dt=Math.min((now-previous)/1000,MAX_FRAME_SECONDS);previous=now;if(!paused){age+=dt;if(age>juiceDuration(burst)){paused=true;announce();}}
  timing.setReducedMotion(reduced.checked);
  if(live&&!paused){
    const scale=governor.apply(timing.timeScale(),dt);timing.update(dt);accumulator+=dt*scale;
    stopped=scale===0?stopped+dt:0;longestStop=Math.max(longestStop,stopped);if(scale>0)slowest=Math.min(slowest,scale);
    while(accumulator>=DT){scene.simulation.stepFixed();accumulator-=DT;}
    const current=scene.simulation.getSnapshot(),id=scene.event.bodyIds?.[2];
    scene={...scene,background:{...current,bodies:current.bodies.filter(b=>b.id!==id)},result:current.bodies.find(b=>b.id===id),prediction:scene.simulation.predict(dropAt(-Math.PI/2))};
    clockText.textContent=`実計算 tick ${current.tick}・連続停止 ${(longestStop*1000).toFixed(1)}ms・スロー最小 ${slowest.toFixed(2)}倍`;
  }
  const snapshot={...scene.background,bodies:[]};
  renderer.draw({prev:snapshot,curr:snapshot,alpha:1,timeSeconds:0,aim:null,reducedMotion:reduced.checked,aimGuide:true,dimmed:false});
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,effects.width,effects.height);
  const scale=effects.width/BOARD_SIZE;ctx.setTransform(scale,0,0,scale,effects.width/2,effects.height/2);
  if(age<=juiceDuration(burst))paint(ctx,burst,age);else {subjects(ctx,burst,age,scene);foreground(ctx,scene);}
  const view=juiceView(burst,age,reduced.checked),ratio=stage.clientWidth/BOARD_SIZE;
  const transform=`translate(${view.x*ratio}px,${view.y*ratio}px) scale(${view.zoom})`;
  board.style.transform=transform;effects.style.transform=transform;
  requestAnimationFrame(frame);
}
function compare():void {
  const out=document.getElementById('juice-frames')!;out.replaceChildren();document.getElementById('juice-comparison')!.hidden=false;
  document.getElementById('juice-comparison-title')!.textContent='同じ出来事の3案';
  for(const key of Object.keys(names) as JuiceDirection[]){
    const snapshot={...scene.background,bodies:[]};
    const figure=document.createElement('figure');const canvas=document.createElement('canvas');canvas.width=480;canvas.height=480;
    const r=createBoardRenderer(canvas);r.resize(480);r.draw({prev:snapshot,curr:snapshot,alpha:1,timeSeconds:0,aim:null,reducedMotion:false,aimGuide:true,dimmed:false});
    const overlay=document.createElement('canvas');overlay.width=canvas.width;overlay.height=canvas.height;const context=overlay.getContext('2d')!;const s=overlay.width/BOARD_SIZE;context.setTransform(s,0,0,s,overlay.width/2,overlay.height/2);
    const item=makeJuiceBurst(event,key,appearanceSeed)!,seconds=Number(slider.value)/1000;
    paint(context,item,seconds);composite(canvas,overlay);transformComparison(canvas,item,seconds);
    canvas.style.width='100%';canvas.style.height='auto';
    const caption=document.createElement('figcaption');caption.textContent=names[key];figure.append(canvas,caption);out.append(figure);
  }
}
function timeline():void {
  const out=document.getElementById('juice-frames')!;out.replaceChildren();document.getElementById('juice-comparison')!.hidden=false;
  document.getElementById('juice-comparison-title')!.textContent='1・3・5連鎖の時系列';
  for(const chain of [1,3,5]){
    const current=createJuiceScene(2,chain),snapshot={...current.background,bodies:[]};
    const figure=document.createElement('figure');figure.style.gridColumn='1/-1';const strip=document.createElement('canvas');strip.width=960;strip.height=240;const context=strip.getContext('2d')!;
    const item=makeJuiceBurst(current.event,direction,appearanceSeed)!;
    for(const [index,seconds] of [.04,.1,.28,.8].entries()){
      const tile=document.createElement('canvas');const render=createBoardRenderer(tile);render.resize(240);render.draw({prev:snapshot,curr:snapshot,alpha:1,timeSeconds:0,aim:null,reducedMotion:false,aimGuide:true,dimmed:false});
      const overlay=document.createElement('canvas');overlay.width=tile.width;overlay.height=tile.height;const drawing=overlay.getContext('2d')!;const scale=overlay.width/BOARD_SIZE;drawing.setTransform(scale,0,0,scale,overlay.width/2,overlay.height/2);
      paint(drawing,item,seconds,current);composite(tile,overlay);transformComparison(tile,item,seconds);context.drawImage(tile,index*240,0,240,240);
    }
    const caption=document.createElement('figcaption');caption.textContent=`${chain}連鎖：左から0.04 / 0.10 / 0.28 / 0.80秒`;figure.append(strip,caption);out.append(figure);
  }
}
function composite(base:HTMLCanvasElement,overlay:HTMLCanvasElement):void {
  // 盤面の描画後は論理座標の変換が残る。画像の合成には物理ピクセルを使う。
  const context=base.getContext('2d')!;context.save();context.setTransform(1,0,0,1,0,0);context.drawImage(overlay,0,0);context.restore();
}
function transformComparison(canvas:HTMLCanvasElement,item:JuiceBurst,seconds:number):void {
  const view=juiceView(item,seconds,reduced.checked),copy=document.createElement('canvas');
  copy.width=canvas.width;copy.height=canvas.height;copy.getContext('2d')!.drawImage(canvas,0,0);
  const context=canvas.getContext('2d')!,ratio=canvas.width/BOARD_SIZE;
  context.save();context.setTransform(1,0,0,1,0,0);context.fillStyle='#070b18';context.fillRect(0,0,canvas.width,canvas.height);
  context.translate(canvas.width/2+view.x*ratio,canvas.height/2+view.y*ratio);context.scale(view.zoom,view.zoom);
  context.drawImage(copy,-canvas.width/2,-canvas.height/2);context.restore();
}
function measure():void {
  const canvas=document.createElement('canvas');canvas.width=BOARD_SIZE;canvas.height=BOARD_SIZE;const context=canvas.getContext('2d')!;const samples:number[]=[];
  for(let i=0;i<360;i++){context.setTransform(1,0,0,1,BOARD_SIZE/2,BOARD_SIZE/2);const start=performance.now();context.clearRect(-BOARD_SIZE/2,-BOARD_SIZE/2,BOARD_SIZE,BOARD_SIZE);paint(context,burst,(i%120)/60);if(i>=120)samples.push(performance.now()-start);}
  samples.sort((a,b)=>a-b);document.getElementById('juice-performance')!.textContent=`${burst.supernova?'超新星':`${burst.chain}連鎖`}・240コマのCPU描画：95% ${samples[Math.ceil(samples.length*.95)-1]!.toFixed(2)}ms、最大 ${samples.at(-1)!.toFixed(2)}ms。40層以上への追加と動画審査は未完です。`;
}
announce();requestAnimationFrame(frame);
