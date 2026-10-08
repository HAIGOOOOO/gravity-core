// 見本ページ: 盤面と照準（担当 B が自由に書き足してよい）。
// 本物の計算を動かし、担当 B の描画と入力だけをつないでいる。HUD・演出・音は無い。

import type { AimView, GuideView } from '../contracts/app';
import type { GameSnapshot, SimulationPort } from '../contracts/game';
import { setupAboutToMerge, setupAllTiers, setupCrowded } from '../fixtures';
import { DT, GUIDE_INWARD_DEGREES, GUIDE_LEAD_DEGREES, GUIDE_SPEED } from '../game/constants';
import { clockwiseTangent } from '../game/physics';
import { createSimulation, type SimulationSetup } from '../game/simulation';
import { createPointerInput } from '../input';
import { createBoardRenderer } from '../render';
import { speedToDrag } from '../shared/launch';
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
let timeMarkers = true;
let showGuide = true;
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
  onTapOnly: () => log('タップだけ（射出しない）'),
}).setEnabled(true);

function guide(snap: GameSnapshot): GuideView | null {
  const target = snap.bodies[0];
  if (!showGuide || !target) return null;
  const angle = Math.atan2(target.y, target.x) + (GUIDE_LEAD_DEGREES * Math.PI) / 180;
  const t = clockwiseTangent(angle);
  const th = (GUIDE_INWARD_DEGREES * Math.PI) / 180;
  return {
    originAngleRadians: angle,
    dirX: Math.cos(th) * t.x - Math.sin(th) * Math.cos(angle),
    dirY: Math.cos(th) * t.y - Math.sin(th) * Math.sin(angle),
    dragPx: speedToDrag(GUIDE_SPEED),
  };
}

function frame(now: number): void {
  const delta = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (!paused) {
    timeSeconds += delta;
    acc += delta;
    while (acc >= DT) {
      prev = sim.getSnapshot();
      for (const e of sim.stepFixed()) if (e.kind !== 'bounce') log(`${e.kind} ${e.heatDelta ?? ''}`);
      acc -= DT;
    }
  }
  const curr = sim.getSnapshot();
  renderer.draw({ prev, curr, alpha: paused ? 1 : acc / DT, timeSeconds, aim, guide: guide(curr), reducedMotion, timeMarkers, dimmed });
  requestAnimationFrame(frame);
}

addGroup('盤面');
addButton('開始時', () => load());
addButton('全 Tier', () => load(setupAllTiers()));
addButton('混雑 40 体', () => load(setupCrowded()));
addButton('融合直前', () => load(setupAboutToMerge(2)));
addGroup('熱量');
for (const h of [15, 45, 75, 95]) addButton(String(h), () => load(setupAllTiers(h)));
addGroup('表示');
addToggle('止める', false, (on) => (paused = on));
addToggle('暗くする', false, (on) => (dimmed = on));
addToggle('動きを減らす', false, (on) => (reducedMotion = on));
addToggle('時刻マーカー', true, (on) => (timeMarkers = on));
addToggle('初回の案内', true, (on) => (showGuide = on));
addSlider('大きさ', 280, 900, 560, resize);

resize(560);
requestAnimationFrame(frame);
