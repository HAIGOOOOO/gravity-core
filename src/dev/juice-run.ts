import type { BodyView } from '../contracts/game';
import { BOARD_SIZE, CORE_RADIUS, DT, TICK_HZ } from '../game/constants';
import { dropAt } from '../fixtures';
import { createTimeGovernor } from '../shared/time';
import { createBoardRenderer } from '../render';
import { drawJuiceForeground } from '../render/juice-foreground';
import { drawJuice } from '../render/juice-shapes';
import { drawJuiceLabels } from '../render/juice-labels';
import { drawJuiceMemories, drawJuiceReflections } from '../render/juice-reflections';
import { drawJuiceAtmosphere } from '../render/juice-atmosphere';
import { drawJuiceAfterimage, drawJuiceCooling, drawJuiceDeadline, drawJuiceExposure, drawJuiceShadows, drawJuiceTypeChips } from '../render/juice-peak';
import { createJuiceTiming, juiceView } from '../render/juice-timing';
import { juiceDuration, makeJuiceBurst, type JuiceBurst, type JuiceDirection } from '../render/juice-model';
import { createJuiceChain } from './juice-chain';
import { createJuiceCapture } from './juice-capture';

type ActiveBurst={burst:JuiceBurst;age:number;sources:readonly BodyView[];resultId:number|undefined};
const MAX_BURSTS=8;

export function createJuiceRun(board:HTMLCanvasElement,effects:HTMLCanvasElement,stage:HTMLElement,status:HTMLElement,host:HTMLElement) {
  const renderer=createBoardRenderer(board),ctx=effects.getContext('2d')!,capture=createJuiceCapture(host);
  const timing=createJuiceTiming(),governor=createTimeGovernor();
  let simulation=createJuiceChain(),active=false,accumulator=0,elapsed=0,direction:JuiceDirection='fracture';
  let bursts:ActiveBurst[]=[],ticks:number[]=[];
  let dirty=true,wasReduced=false,paused=false;
  function start(next:JuiceDirection,record=false):void {
    if(capture.recording)return;
    if(record&&!capture.start())return;
    simulation=createJuiceChain();active=true;accumulator=0;elapsed=0;direction=next;bursts=[];ticks=[];dirty=true;paused=false;timing.clear();governor.reset();
  }
  return {
    start,
    get active(){return active;},
    get recording(){return capture.recording;},
    togglePause(){if(!capture.recording){paused=!paused;dirty=true;}},
    redraw(){dirty=true;},
    inspect(){const snapshot=simulation.getSnapshot();return {tick:snapshot.tick,score:snapshot.score,maxChain:snapshot.stats.maxChain,mergeTicks:[...ticks]};},
    stop(){if(capture.recording)return;active=false;},
    frame(seconds:number,reduced:boolean):void {
      dirty=dirty||wasReduced!==reduced;wasReduced=reduced;
      if(paused&&!dirty)return;
      if(paused)seconds=0;
      if(!dirty&&simulation.getSnapshot().tick>=TICK_HZ*6&&elapsed>=10&&!capture.recording)return;
      dirty=false;
      elapsed+=seconds;timing.setReducedMotion(reduced);
      accumulator+=seconds*governor.apply(timing.timeScale(),seconds);timing.update(seconds);
      bursts.forEach(item=>item.age+=seconds);
      while(accumulator>=DT&&simulation.getSnapshot().tick<TICK_HZ*6){
        const before=simulation.getSnapshot();
        for(const event of simulation.stepFixed()){
          const burst=makeJuiceBurst(event,direction);
          if(!burst)continue;
          bursts.push({burst,age:0,sources:before.bodies.filter(body=>event.bodyIds?.slice(0,2).includes(body.id)),resultId:event.bodyIds?.[2]});
          timing.start(burst);ticks.push(event.tick);
        }
        accumulator-=DT;
      }
      if(simulation.getSnapshot().tick>=TICK_HZ*6)accumulator=0;
      bursts=bursts.filter(item=>item.age<=juiceDuration(item.burst)).slice(-MAX_BURSTS);
      const snapshot=simulation.getSnapshot(),latest=bursts.at(-1);
      renderer.draw({prev:snapshot,curr:snapshot,alpha:1,timeSeconds:elapsed,aim:null,reducedMotion:reduced,aimGuide:true,dimmed:false});
      ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,effects.width,effects.height);
      const scale=effects.width/BOARD_SIZE;ctx.setTransform(scale,0,0,scale,effects.width/2,effects.height/2);
      if(latest){
        ctx.save();if(reduced)ctx.globalAlpha*=Math.max(0,1-latest.age/.9);
        drawJuiceAtmosphere(ctx,latest.burst,reduced?.28:latest.age);ctx.restore();
        drawJuiceExposure(ctx,latest.burst,latest.age,reduced);
      }
      for(const item of bursts){
        ctx.save();if(item!==latest)ctx.globalAlpha*=.3;
        drawJuice(ctx,item.burst,item.age,reduced);
        if(!reduced){drawJuiceMemories(ctx,item.burst,item.sources,item.age);drawJuiceAfterimage(ctx,item.burst,item.age);drawJuiceShadows(ctx,item.burst,item.age);}
        ctx.restore();
      }
      // 現在も存在する天体だけを透かす。消費済みの結果を演出側で復活させない。
      ctx.save();ctx.globalCompositeOperation='destination-out';
      ctx.beginPath();ctx.arc(0,0,CORE_RADIUS+4,0,Math.PI*2);ctx.fill();
      for(const body of snapshot.bodies){ctx.beginPath();ctx.arc(body.x,body.y,body.radius+3,0,Math.PI*2);ctx.fill();}ctx.restore();
      if(latest){
        const {burst,age}=latest;
        if(!reduced){drawJuiceReflections(ctx,burst,snapshot.bodies,age);drawJuiceCooling(ctx,burst,age);drawJuiceTypeChips(ctx,burst,age);}
        drawJuiceDeadline(ctx,burst,snapshot.bodies.find(body=>body.id===latest.resultId),snapshot,age,true);
        drawJuiceLabels(ctx,burst,age,reduced);
      }
      drawJuiceForeground(ctx,snapshot,snapshot.bodies,simulation.predict(dropAt(-Math.PI/2)));
      const view=latest?juiceView(latest.burst,latest.age,reduced):{x:0,y:0,zoom:1},ratio=stage.clientWidth/BOARD_SIZE;
      const transform=`translate(${view.x*ratio}px,${view.y*ratio}px) scale(${view.zoom})`;
      board.style.transform=transform;effects.style.transform=transform;
      capture.frame(board,effects,view,snapshot.tick,snapshot.stats.maxChain,!latest);
      status.textContent=`実計算${paused?'（静止中）':''} ${snapshot.stats.maxChain}連鎖・${snapshot.score.toLocaleString('ja-JP')}点・tick ${snapshot.tick}。合体のtick：${ticks.join(' → ')}。連鎖数と得点は書き換えていません。`;
    },
  };
}
