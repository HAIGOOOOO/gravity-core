// 見本ページ: 盤面と照準（担当 B が自由に書き足してよい）。
// 本物の計算を動かし、担当 B の描画と入力だけをつないでいる。HUD・演出・音は無い。

import type { AimView } from '../contracts/app';
import type { GameSnapshot, SimulationPort } from '../contracts/game';
import { createAutoPlay, setupAllTiers } from '../fixtures';
import { DT } from '../game/constants';
import { createSimulation, type SimulationSetup } from '../game/simulation';
import { createPointerInput } from '../input';
import { createBoardRenderer } from '../render';
import { addButton, addGroup, addSlider, addToggle, log } from './demo-kit';

const stage = document.getElementById('stage')!;
const canvas = document.getElementById('board') as HTMLCanvasElement;
const renderer = createBoardRenderer(canvas);

let sim: SimulationPort = createSimulation(1);
let prev: GameSnapshot = sim.getSnapshot();
let aim: AimView | null = null;
let paused = false;
let dimmed = false;
let reducedMotion = false;
let aimGuide = true;
let timeSeconds = 0;
let acc = 0;
let last = performance.now();

function load(setup?: SimulationSetup): void {
  sim = createSimulation(1, setup);
  prev = sim.getSnapshot();
}

function resize(size: number): void {
  stage.style.width = `${size}px`;
  stage.style.height = `${size}px`;
  renderer.resize(size);
}

createPointerInput(canvas, {
  getSnapshot: () => sim.getSnapshot(),
  predict: (c) => sim.predict(c),
  onAim: (a) => (aim = a),
  onLaunch: (c) => log(`射出: ${JSON.stringify(sim.submitLaunch(c))}`),
}).setEnabled(true);

function frame(now: number): void {
  const delta = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (!paused) {
    timeSeconds += delta;
    acc += delta;
    while (acc >= DT) {
      prev = sim.getSnapshot();
      for (const e of sim.stepFixed()) if (e.kind !== 'land') log(`${e.kind} ${e.scoreDelta ?? ''}`);
      acc -= DT;
    }
  }
  const curr = sim.getSnapshot();
  renderer.draw({ prev, curr, alpha: paused ? 1 : acc / DT, timeSeconds, aim, reducedMotion, aimGuide, dimmed });
  requestAnimationFrame(frame);
}

addGroup('盤面');
addButton('開始時', () => load());
addButton('空', () => load({ bodies: [] }));
addButton('全 Tier', () => load(setupAllTiers()));
for (const seconds of [30, 90, 180]) {
  addButton(`${seconds} 秒遊んだ後`, () => {
    sim = createAutoPlay(7, undefined, seconds).sim;
    prev = sim.getSnapshot();
  });
}
addGroup('熱量');
for (const h of [0, 30, 60, 90]) addButton(String(h), () => load(setupAllTiers(h)));
addGroup('表示');
addToggle('止める', false, (on) => (paused = on));
addToggle('暗くする', false, (on) => (dimmed = on));
addToggle('動きを減らす', false, (on) => (reducedMotion = on));
addToggle('予測線', true, (on) => (aimGuide = on));
addSlider('大きさ', 280, 900, 560, resize);

resize(560);
requestAnimationFrame(frame);
