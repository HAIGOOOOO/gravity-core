import './impact.css';
import type { GameEvent } from '../contracts/game';
import { DT, MAX_FRAME_SECONDS } from '../game/constants';
import { createSimulation } from '../game/simulation';
import { createEffectsLayer } from '../effects';
import { createBoardRenderer } from '../render';
import { createTimeGovernor } from '../shared/time';
import { createImpactCapture } from './impact-capture';
import { impactSetup, type ImpactScene as Scene } from './impact-fixtures';

const board = document.querySelector<HTMLCanvasElement>('#board')!;
const canvas = document.querySelector<HTMLCanvasElement>('#effects')!;
const stage = document.querySelector<HTMLElement>('.impact-stage')!;
const status = document.querySelector<HTMLElement>('#status')!;
const reduced = document.querySelector<HTMLInputElement>('#reduced')!;
const pause = document.querySelector<HTMLButtonElement>('#pause')!;
const controls = [...document.querySelectorAll<HTMLButtonElement>('[data-scene]')];
const effects = createEffectsLayer(canvas, stage);
const renderer = createBoardRenderer(board), governor = createTimeGovernor();
const capture = createImpactCapture(document.querySelector('#exports')!, document.querySelector('#record-status')!, document.querySelector('#recording')!);
const motion = matchMedia('(prefers-reduced-motion: reduce)');
reduced.checked = motion.matches;
effects.setReducedMotion(reduced.checked);
reduced.addEventListener('change', () => effects.setReducedMotion(reduced.checked));

function simulationFor(scene: Scene) {
  return createSimulation(13, impactSetup(scene));
}

let scene: Scene = 'merge', sim = simulationFor(scene), prev = sim.getSnapshot();
let elapsed = 0, acc = 0, paused = false, previous = performance.now();
let log: GameEvent[] = [];
let freezeOnPeak = false, peakAt = Infinity;
function start(next = scene): void {
  scene = next; sim = simulationFor(scene); prev = sim.getSnapshot();
  elapsed = 0; acc = 0; log = []; paused = false; pause.textContent = '一時停止';
  freezeOnPeak = false; peakAt = Infinity;
  effects.clear(); governor.reset(); previous = performance.now();
  for (const control of controls) control.setAttribute('aria-pressed', String(control.dataset.scene === scene));
}
for (const button of controls) button.addEventListener('click', () => { if (!capture.active) start(button.dataset.scene as Scene); });
document.querySelector('#again')!.addEventListener('click', () => { if (!capture.active) start(); });
pause.addEventListener('click', () => {
  if (capture.active) return;
  paused = !paused; pause.textContent = paused ? '再生' : '一時停止';
});
document.querySelector('#freeze')!.addEventListener('click', () => {
  if (capture.active) return;
  start(); freezeOnPeak = true;
});
document.querySelector('#record')!.addEventListener('click', () => {
  if (capture.active) return;
  start(); capture.start(scene);
});
new ResizeObserver(() => { renderer.resize(stage.clientWidth); effects.resize(stage.clientWidth); }).observe(stage);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !capture.active) { paused = true; pause.textContent = '再生'; }
  previous = performance.now();
});
function frame(now: number): void {
  const dt = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - previous) / 1000)); previous = now;
  if (!paused) {
    elapsed += dt;
    acc += dt * governor.apply(effects.timeScale?.() ?? 1, dt);
    while (acc >= DT && elapsed >= .35 && sim.getSnapshot().tick < 720) {
      prev = sim.getSnapshot();
      const events = sim.stepFixed();
      log.push(...events.filter(event => event.kind === 'merge' || event.kind === 'supernova'));
      if (freezeOnPeak && events.some(event => event.kind === 'supernova'
        || event.kind === 'merge' && (scene !== 'chain' || (event.chain ?? 1) >= 5))) peakAt = elapsed + .2;
      effects.handleEvents(events, sim.getSnapshot()); acc -= DT;
    }
    if (elapsed < .35 || sim.getSnapshot().tick >= 720) acc = 0;
    effects.update(dt);
    if (elapsed >= peakAt) { paused = true; pause.textContent = '再生'; }
  }
  const curr = sim.getSnapshot();
  renderer.draw({ prev, curr, alpha: Math.min(1, acc / DT), timeSeconds: elapsed, aim: null, reducedMotion: reduced.checked, aimGuide: true, dimmed: false });
  effects.draw();
  const label = `実計算 ${curr.stats.maxChain}連鎖・${curr.score.toLocaleString('ja-JP')}点・tick ${curr.tick}`;
  status.textContent = label + ' ／ 合体tick ' + log.map(event => event.tick).join(' → ');
  capture.frame(board, canvas, stage, label);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
