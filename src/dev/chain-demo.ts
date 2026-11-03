import '../styles/juice.css';
import { DPR_CAP, MAX_FRAME_SECONDS } from '../game/constants';
import { createBoardRenderer } from '../render';
import { createJuiceRun } from './juice-run';

const board=document.getElementById('juice-board') as HTMLCanvasElement;
const effects=document.getElementById('juice-effects') as HTMLCanvasElement;
const stage=document.querySelector<HTMLElement>('.juice-stage')!;
const reduced=document.getElementById('chain-reduced') as HTMLInputElement;
const renderer=createBoardRenderer(board);
const run=createJuiceRun(board,effects,stage,document.getElementById('chain-status')!,document.querySelector('main')!);
const log=document.getElementById('chain-events')!;
let showLog=false;
document.getElementById('chain-replay')!.addEventListener('click',()=>run.start('fracture'));
document.getElementById('chain-log')!.addEventListener('click',()=>{showLog=!showLog;log.hidden=!showLog;});
document.getElementById('chain-record')!.addEventListener('click',()=>run.start('fracture',true));
new ResizeObserver(()=>{
  const size=stage.clientWidth;renderer.resize(size);
  effects.width=effects.height=Math.round(size*Math.min(devicePixelRatio,DPR_CAP));
  board.style.width=board.style.height='100%';
  run.redraw();
}).observe(stage);
const header=document.querySelector('header')!;
new ResizeObserver(()=>document.documentElement.style.setProperty('--juice-header-height',`${header.getBoundingClientRect().height}px`)).observe(header);
run.start('fracture');
let previous=performance.now();
function frame(now:number):void {
  const seconds=Math.min(MAX_FRAME_SECONDS,Math.max(0,(now-previous)/1000));previous=now;
  run.frame(seconds,reduced.checked);
  if(showLog)log.textContent=JSON.stringify(run.inspect(),null,2);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
