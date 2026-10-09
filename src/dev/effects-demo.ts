// 見本ページ: 演出と音（担当 C が自由に書き足してよい）。
// ボタンで出来事を 1 つずつ起こすか、「自動プレイ」で本物の計算から出来事を流す。

import type { GameEvent, GameEventKind, GameSnapshot, SimulationPort, Tier } from '../contracts/game';
import { createAudioManager } from '../audio';
import { createEffectsLayer, inspectEffects } from '../effects';
import { createAutoPlay, sampleEvent, setupAllTiers } from '../fixtures';
import { DT, FLOAT_TEXT_CAP, HEAT_STATE_LIMITS, MAX_FRAME_SECONDS, PARTICLE_CAP } from '../game/constants';
import { createSimulation } from '../game/simulation';
import { createBoardRenderer } from '../render';
import { addButton, addGroup, addSlider, addToggle, log } from './demo-kit';

const stage = document.getElementById('stage')!;
const renderer = createBoardRenderer(document.getElementById('board') as HTMLCanvasElement);
const effectsCanvas = document.getElementById('effects') as HTMLCanvasElement;
const effects = createEffectsLayer(effectsCanvas, stage);
const audio = createAudioManager();

// TODO(依頼中): 共通の strings へ移してほしい見本ページの文言。
const FOUNDATION = {
  group: '演出の土台（手順 1）', sample: '粒子・輪・浮き文字の見本',
  stress: '毎秒100回（10秒）', stop: '負荷テストを止める',
  idle: '待機', running: '負荷テスト中', finished: '負荷テスト完了',
  particles: '粒子', rings: '輪', texts: '浮き文字', events: '出来事',
};
const STRESS_RATE = 100;
const STRESS_SECONDS = 10;
const COUNTER_SECONDS = 0.1;
const CONTROLS_GAP = 24;
const AUTO_WARMUP_SECONDS = 30;
let stressLeft = 0;
let stressEvents = 0;
let counterAccumulator = COUNTER_SECONDS;
let status = FOUNDATION.idle;
const counter = document.getElementById('effect-counts')!;

let sim: SimulationPort = createSimulation(1, setupAllTiers());
let auto: ReturnType<typeof createAutoPlay> | null = null;
let autoWarmup = 0;
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
    if (e.kind !== 'land') log(`${e.kind} tier=${e.sourceTier ?? '-'} chain=${e.chain ?? '-'} heat=${e.heatDelta ?? '-'}`);
    if (e.kind === 'gameOver') effects.playGameOver();
  }
  audio.setCritical(snap.phase === 'active' && snap.heat >= HEAT_STATE_LIMITS[2]);
}

function resetAuto(warmup: number): void {
  const seed = Date.now() % 1000;
  auto = createAutoPlay(seed, undefined, warmup);
  // 見本の準備中に終了した場合は、新しいプレイから出来事を流す。
  if (auto.sim.getSnapshot().phase === 'over') auto = createAutoPlay(seed);
  sim = auto.sim;
  prev = sim.getSnapshot();
  effects.clear();
  audio.setCritical(false);
}

function frame(now: number): void {
  const delta = Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
  last = now;
  timeSeconds += delta;
  acc += delta;
  while (acc >= DT) {
    if (auto && sim.getSnapshot().phase === 'over') {
      resetAuto(autoWarmup);
    }
    prev = sim.getSnapshot();
    fire(auto ? auto.step() : sim.stepFixed());
    acc -= DT;
  }
  effects.update(delta);
  if (stressLeft > 0) {
    const elapsed = Math.min(delta, stressLeft);
    stressLeft = Math.max(0, stressLeft - elapsed);
    const targetEvents = stressLeft === 0 ? STRESS_RATE * STRESS_SECONDS
      : Math.floor((STRESS_SECONDS - stressLeft) * STRESS_RATE);
    while (stressEvents < targetEvents) {
      effects.handleEvents([sampleEvent('merge', tier, 160, -120, chain)], sim.getSnapshot());
      stressEvents++;
    }
    if (stressLeft === 0) status = FOUNDATION.finished;
  }
  renderer.draw({ prev, curr: sim.getSnapshot(), alpha: acc / DT, timeSeconds, aim: null, reducedMotion: false, aimGuide: true, dimmed: false });
  effects.draw();
  counterAccumulator += delta;
  if (counterAccumulator >= COUNTER_SECONDS) {
    counterAccumulator = 0;
    const counts = inspectEffects(effectsCanvas);
    counter.textContent = `${status} · ${FOUNDATION.events} ${stressEvents} · ${FOUNDATION.particles} ${counts.particles}/${PARTICLE_CAP} · ${FOUNDATION.rings} ${counts.rings} · ${FOUNDATION.texts} ${counts.texts}/${FLOAT_TEXT_CAP}`;
  }
  requestAnimationFrame(frame);
}

function resize(size: number): void {
  stage.style.width = `${size}px`;
  stage.style.height = `${size}px`;
  renderer.resize(size);
  effects.resize(size);
}

addGroup(FOUNDATION.group);
addButton(FOUNDATION.sample, () => fire([sampleEvent('merge', tier, 160, -120, chain)]));
addButton(FOUNDATION.stress, () => {
  effects.clear();
  stressLeft = STRESS_SECONDS;
  stressEvents = 0;
  status = FOUNDATION.running;
});
addButton(FOUNDATION.stop, () => {
  stressLeft = 0;
  status = FOUNDATION.idle;
  effects.clear();
});

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
  ['着地', 'land'],
  ['合体', 'merge'],
  ['超新星', 'supernova'],
  ['限界を越えた', 'overLimitStart'],
  ['限界の内側に戻った', 'overLimitEnd'],
  ['終了', 'gameOver'],
];
for (const [label, kind] of kinds) addButton(label, () => fire([sampleEvent(kind, tier, 160, -120, chain)]));

addGroup('盤面');
addButton('自動プレイ', () => {
  autoWarmup = 0;
  resetAuto(autoWarmup);
});
addButton('自動プレイ（山ができた後）', () => {
  autoWarmup = AUTO_WARMUP_SECONDS;
  resetAuto(autoWarmup);
});
addButton('静かな盤面', () => {
  auto = null;
  sim = createSimulation(1, setupAllTiers());
  prev = sim.getSnapshot();
  effects.clear();
});
addToggle('動きを減らす', false, (on) => effects.setReducedMotion(on));
addButton('演出を全部消す', () => {
  stressLeft = 0;
  status = FOUNDATION.idle;
  effects.clear();
});

document.addEventListener('visibilitychange', () => {
  // 隠れていた秒数をまとめて進めず、復帰後は新しいフレームから始める。
  last = performance.now();
  acc = 0;
});

const controls = document.getElementById('demo-controls')!;
new ResizeObserver(() => {
  // ボタンが折り返されても、盤面を操作欄の下に置く。
  stage.style.marginTop = `${controls.getBoundingClientRect().height + CONTROLS_GAP}px`;
}).observe(controls);

resize(560);
requestAnimationFrame(frame);
