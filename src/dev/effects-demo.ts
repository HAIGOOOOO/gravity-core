// 見本ページ: 演出と音（担当 C が自由に書き足してよい）。
// ボタンで出来事を 1 つずつ起こすか、「自動プレイ」で本物の計算から出来事を流す。

import type { GameEvent, GameEventKind, GameSnapshot, SimulationPort, Tier } from '../contracts/game';
import { createAudioManager } from '../audio';
import { createEffectsLayer } from '../effects';
import { createAutoPlay, sampleEvent, setupAllTiers, setupCrowded } from '../fixtures';
import { DT, HEAT_STATE_LIMITS } from '../game/constants';
import { createSimulation } from '../game/simulation';
import { createBoardRenderer } from '../render';
import { addButton, addGroup, addSlider, addToggle, log } from './demo-kit';

const stage = document.getElementById('stage')!;
const renderer = createBoardRenderer(document.getElementById('board') as HTMLCanvasElement);
const effects = createEffectsLayer(document.getElementById('effects') as HTMLCanvasElement, stage);
const audio = createAudioManager();

let sim: SimulationPort = createSimulation(1, setupAllTiers());
let auto: ReturnType<typeof createAutoPlay> | null = null;
let prev: GameSnapshot = sim.getSnapshot();
let tier: Tier = 2;
let chain = 1;
let sfx = true;
let volume = 70;
let acc = 0;
let timeSeconds = 0;
let last = performance.now();

function fire(events: readonly GameEvent[]): void {
  if (events.length === 0) return;
  const snap = sim.getSnapshot();
  effects.handleEvents(events, snap);
  audio.handleEvents(events, snap);
  for (const e of events) {
    if (e.kind !== 'bounce') log(`${e.kind} tier=${e.sourceTier ?? '-'} chain=${e.chain ?? '-'} heat=${e.heatDelta ?? '-'}`);
    if (e.kind === 'gameOver') effects.playGameOver();
  }
  audio.setCritical(snap.phase === 'active' && snap.heat >= HEAT_STATE_LIMITS[2]);
}

function frame(now: number): void {
  const delta = Math.min((now - last) / 1000, 0.05);
  last = now;
  timeSeconds += delta;
  acc += delta;
  while (acc >= DT) {
    prev = sim.getSnapshot();
    fire(auto ? auto.step() : sim.stepFixed());
    acc -= DT;
  }
  effects.update(delta);
  renderer.draw({ prev, curr: sim.getSnapshot(), alpha: acc / DT, timeSeconds, aim: null, guide: null, reducedMotion: false, timeMarkers: true, dimmed: false });
  effects.draw();
  requestAnimationFrame(frame);
}

function resize(size: number): void {
  stage.style.width = `${size}px`;
  stage.style.height = `${size}px`;
  renderer.resize(size);
  effects.resize(size);
}

addGroup('音');
addButton('音を有効にする（最初に押す）', () => {
  audio.unlock();
  audio.setSettings({ sfx, volume });
});
addToggle('効果音', true, (on) => audio.setSettings({ sfx: (sfx = on), volume }));
addSlider('音量', 0, 100, 70, (v) => audio.setSettings({ sfx, volume: (volume = v) }));
addToggle('臨界の警告音', false, (on) => audio.setCritical(on));
addButton('ボタン音', () => audio.play('button'));
addButton('ベスト更新', () => audio.play('bestScore'));

addGroup('出来事');
addSlider('Tier', 0, 8, 2, (v) => (tier = v as Tier));
addSlider('連鎖', 1, 5, 1, (v) => (chain = v));
const kinds: [string, GameEventKind][] = [
  ['射出', 'launch'],
  ['反発', 'bounce'],
  ['融合', 'merge'],
  ['核へ落下', 'absorb'],
  ['流出', 'escape'],
  ['過密', 'densityPurge'],
  ['超新星', 'supernova'],
  ['終了', 'gameOver'],
];
for (const [label, kind] of kinds) addButton(label, () => fire([sampleEvent(kind, tier, 200, -120, chain)]));
addButton('速すぎる反発', () => fire([{ ...sampleEvent('bounce', tier), tooFast: true }]));

addGroup('盤面');
addButton('自動プレイ', () => {
  auto = createAutoPlay(Date.now() % 1000);
  sim = auto.sim;
  prev = sim.getSnapshot();
  effects.clear();
});
addButton('自動プレイ（混雑）', () => {
  auto = createAutoPlay(Date.now() % 1000, setupCrowded(60));
  sim = auto.sim;
  prev = sim.getSnapshot();
  effects.clear();
});
addButton('静かな盤面', () => {
  auto = null;
  sim = createSimulation(1, setupAllTiers());
  prev = sim.getSnapshot();
  effects.clear();
});
addToggle('動きを減らす', false, (on) => effects.setReducedMotion(on));
addButton('演出を全部消す', () => effects.clear());

resize(560);
requestAnimationFrame(frame);
