// 見本ページ: 重力をいじる 3 方式（握る・井戸を置く・渦）の試作。
// 本物の計算（src/game/）をそのまま動かし、落とす・投げる・合体・熱量・終了まで本物のルールで遊べる。
// 重力操作は SimulationPort.submitGravity を通して入れる（入力の記録に残る）。
// 見た目は今の盤面の描画のまま。目印だけを上に重ねている。

import '../styles/tokens.css';
import './gravity-lab.css';

import type { AimView } from '../contracts/app';
import type { GameSnapshot, GravityCommand, LaunchCommand, SimulationPort } from '../contracts/game';
import { dropAt } from '../fixtures';
import { CORE_RADIUS, DT, LAUNCH_RADIUS, MAX_FRAME_SECONDS, MAX_STEPS_PER_FRAME, TICK_HZ } from '../game/constants';
import { defaultGravityTuning } from '../game/gravity';
import { createRng } from '../game/rng';
import { createSimulation, type SimulationSetup } from '../game/simulation';
import { createPointerInput } from '../input';
import { createBoardRenderer } from '../render';
import { clientToLogical } from '../shared/coords';
import { createOverlay } from './gravity-lab-overlay';
import { MODE_LABEL, createPanel, type LabMode } from './gravity-lab-panel';

const stage = document.getElementById('stage')!;
const boardCanvas = document.getElementById('board') as HTMLCanvasElement;
const overBox = document.getElementById('lab-over')!;
const renderer = createBoardRenderer(boardCanvas);
const overlay = createOverlay(document.getElementById('overlay') as HTMLCanvasElement);

// スライダーが書き換える数値。計算は毎 tick ここを読む
const tuning = defaultGravityTuning();

let seed = 1;
let sim: SimulationPort = createSimulation(seed, undefined, tuning);
let prev: GameSnapshot = sim.getSnapshot();
let mode: LabMode = 'none';
let aim: AimView | null = null;
let aimGuide = true;
let pendingLaunch: LaunchCommand | null = null;
let armed = false;
let pointer: { x: number; y: number } | null = null;
let acc = 0;
let last = performance.now();
let timeSeconds = 0;
let shownOver = false;
// ワンポチ: ゲージ（押している間に満ち引きする輪）と、成功の知らせ
const GAUGE_DELAY = 0.18;
const GAUGE_PERIOD = 0.9;
const GAUGE_OK = 0.86;
let aimStart = -1;
let justAt = -10;
let collapseAt = -10;

/** 押してからの時間で、ゲージの今の値（0〜1）。押していなければ 0。 */
function gaugeValue(): number {
  if (aimStart < 0) return 0;
  const e = timeSeconds - aimStart - GAUGE_DELAY;
  if (e < 0) return 0;
  const phase = (e % GAUGE_PERIOD) / GAUGE_PERIOD;
  return phase < 0.5 ? phase * 2 : 2 - phase * 2;
}

function collapse(): void {
  if (mode !== 'tap') return;
  if (gravity({ kind: 'collapse' })) collapseAt = timeSeconds;
}

function gravity(command: GravityCommand): boolean {
  return sim.submitGravity(command).accepted;
}

// ワンポチ: 崩壊できる時に核を押したら、撃たずに崩壊する（照準より先に受け取るので、ここで先に登録する）
boardCanvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'tap' || !sim.getSnapshot().gravity?.burst.ready) return;
  const p = clientToLogical(boardCanvas, e.clientX, e.clientY);
  if (Math.hypot(p.x, p.y) > CORE_RADIUS + 26) return;
  e.stopImmediatePropagation();
  e.preventDefault();
  collapse();
});

const input = createPointerInput(boardCanvas, {
  getSnapshot: () => sim.getSnapshot(),
  predict: (c) => sim.predict(c),
  onAim: (a) => {
    if (a && !aim) aimStart = timeSeconds;
    if (!a) aimStart = -1;
    aim = a;
  },
  onLaunch(raw) {
    const charged = mode === 'tap' && gaugeValue() >= GAUGE_OK;
    if (charged) justAt = timeSeconds;
    const command = charged ? { ...raw, charged } : raw;
    const res = sim.submitLaunch(command);
    // 待ち時間中に離したら、明けた瞬間に撃つ（本番のアプリと同じ）
    if (!res.accepted && res.reason === 'cooldown') pendingLaunch = command;
  },
});

function setArmed(on: boolean): void {
  armed = on;
  stage.classList.toggle('armed', on);
  // 井戸の場所を選んでいる間は、盤面を押しても落とさない
  if (sim.getSnapshot().phase === 'active') input.setEnabled(!on);
}

/** 押しっぱなしの操作を全部やめる（方式の切り替え、窓から離れたとき）。 */
function releaseAll(): void {
  gravity({ kind: 'grip', on: false });
  gravity({ kind: 'vortex', dir: 0 });
  setArmed(false);
}

function load(setup?: SimulationSetup): void {
  sim = createSimulation(seed, setup, tuning);
  prev = sim.getSnapshot();
  aim = null;
  pendingLaunch = null;
  shownOver = false;
  overBox.hidden = true;
  setArmed(false);
}

/** 勝手に落とし続けて、山ができた盤面から始める（重力操作は使わない）。 */
function warm(seconds: number): void {
  load();
  const rng = createRng(seed + 1);
  let untilNext = 60;
  for (let i = 0; i < seconds * TICK_HZ && sim.getSnapshot().phase === 'active'; i++) {
    if (--untilNext <= 0) {
      sim.submitLaunch(dropAt(rng() * Math.PI * 2));
      untilNext = 110;
    }
    sim.stepFixed();
  }
  prev = sim.getSnapshot();
}

/** 今の盤面をそのまま写した開始状態（熱量だけ変えて続けたいときに使う）。 */
function currentSetup(): SimulationSetup {
  const s = sim.getSnapshot();
  return {
    bodies: s.bodies.map((b) => ({ tier: b.tier, x: b.x, y: b.y, vx: b.vx, vy: b.vy })),
    heat: s.heat,
    queue: [s.nextQueue[0], s.nextQueue[1], s.nextQueue[2]],
    bestTier: s.bestTierThisRun,
  };
}

function wellSpotOk(p: { x: number; y: number }): boolean {
  const r = Math.hypot(p.x, p.y);
  return r >= CORE_RADIUS && r <= LAUNCH_RADIUS;
}

function placeWell(clientX: number, clientY: number): void {
  const p = clientToLogical(boardCanvas, clientX, clientY);
  if (gravity({ kind: 'well', x: p.x, y: p.y })) setArmed(false);
}

function setMode(next: LabMode): void {
  releaseAll();
  mode = next;
  panel.setMode(next);
}

const panel = createPanel(tuning, {
  onMode: setMode,
  onRestart: () => load(),
  onNewSeed() {
    seed++;
    load();
  },
  onWarm: warm,
  onCoolDown: () => load({ ...currentSetup(), heat: 0 }),
  onGrip: (on) => void gravity({ kind: 'grip', on }),
  onVortex: (dir) => void gravity({ kind: 'vortex', dir }),
  onArmWell: () => setArmed(!armed),
  onAimGuide: (on) => (aimGuide = on),
  onCollapse: collapse,
});

// 井戸: 場所を選んでいる間の盤面の押下と、右クリックでの直接設置
boardCanvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'well') return;
  if ((armed && e.button === 0) || e.button === 2) placeWell(e.clientX, e.clientY);
});
boardCanvas.addEventListener('pointermove', (e) => (pointer = clientToLogical(boardCanvas, e.clientX, e.clientY)));
boardCanvas.addEventListener('pointerleave', () => (pointer = null));
boardCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

// キーボードは近道だけ（マウスだけ・タッチだけでも全部できる）
const LEFT_KEYS = ['a', 'A', 'ArrowLeft'];
const RIGHT_KEYS = ['d', 'D', 'ArrowRight'];
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.target instanceof HTMLInputElement) return;
  if (e.key === 'Escape') {
    setArmed(false);
    input.cancel();
  } else if (mode === 'tap' && e.key === ' ') {
    e.preventDefault();
    collapse();
  } else if (mode === 'grip' && e.key === ' ') {
    e.preventDefault();
    gravity({ kind: 'grip', on: true });
  } else if (mode === 'well' && (e.key === 'w' || e.key === 'W')) setArmed(!armed);
  else if (mode === 'vortex' && LEFT_KEYS.includes(e.key)) gravity({ kind: 'vortex', dir: -1 });
  else if (mode === 'vortex' && RIGHT_KEYS.includes(e.key)) gravity({ kind: 'vortex', dir: 1 });
});
window.addEventListener('keyup', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (mode === 'grip' && e.key === ' ') gravity({ kind: 'grip', on: false });
  else if (mode === 'vortex' && (LEFT_KEYS.includes(e.key) || RIGHT_KEYS.includes(e.key))) gravity({ kind: 'vortex', dir: 0 });
});
window.addEventListener('blur', releaseAll);

function resize(): void {
  // 狭い画面では、操作ボタンが盤面の下に固定される（gravity-lab.css）。その分を空けて、盤面と操作を同時に見せる
  const narrow = window.innerWidth <= 760;
  const topBar = document.getElementById('lab-top')?.offsetHeight ?? 50;
  const room = narrow
    ? Math.min(window.innerWidth - 12, window.innerHeight - topBar - 96)
    : Math.min(window.innerWidth - 20, window.innerHeight - 70);
  const size = Math.max(280, Math.min(720, Math.floor(room)));
  stage.style.width = `${size}px`;
  stage.style.height = `${size}px`;
  renderer.resize(size);
  overlay.resize(size);
}
window.addEventListener('resize', resize);

function showOver(snap: GameSnapshot): void {
  shownOver = true;
  input.setEnabled(false);
  overBox.hidden = false;
  const title = document.createElement('div');
  title.textContent = `熱量が 100 になって終了（${MODE_LABEL[mode]}）`;
  const score = document.createElement('div');
  score.textContent = `得点 ${snap.score.toLocaleString('ja-JP')} ／ ${Math.floor(snap.tick / TICK_HZ)} 秒 ／ 重力操作 ${sim.getGravityLog().length} 回`;
  const again = document.createElement('button');
  again.type = 'button';
  again.textContent = 'もう一度';
  again.addEventListener('click', () => load());
  overBox.replaceChildren(title, score, again);
}

function frame(now: number): void {
  const delta = Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
  last = now;
  timeSeconds += delta;
  // 崩壊の間は時間をゆっくりにする（見本ページだけの演出。本番は EffectsLayer.timeScale が受け持つ）
  const collapsing = (sim.getSnapshot().gravity?.collapseLeftSeconds ?? 0) > 0;
  acc += collapsing ? delta * 0.45 : delta;
  let steps = 0;
  while (acc >= DT && steps < MAX_STEPS_PER_FRAME) {
    if (pendingLaunch && sim.getSnapshot().launchCooldownLeftSeconds <= 0) {
      sim.submitLaunch(pendingLaunch);
      pendingLaunch = null;
    }
    prev = sim.getSnapshot();
    sim.stepFixed();
    acc -= DT;
    steps++;
  }
  if (steps === MAX_STEPS_PER_FRAME) acc = 0;

  const curr = sim.getSnapshot();
  if (curr.phase === 'over' && !shownOver) showOver(curr);

  // 山が動いていて当たり先を言い切れないときは、盤面の予測線（着く場所の輪つき）を出さない。
  // 代わりに、道すじを上の Canvas に点線で出す
  const uncertain = aim?.prediction?.uncertain === true;
  renderer.draw({
    prev,
    curr,
    alpha: Math.min(1, acc / DT),
    timeSeconds,
    aim: aim && uncertain ? { ...aim, prediction: null } : aim,
    reducedMotion: false,
    aimGuide,
    dimmed: curr.phase === 'over',
  });
  overlay.draw({
    snap: curr,
    aim,
    aimGuide,
    wellSeconds: tuning.wellSeconds,
    tap:
      mode === 'tap'
        ? { gauge: aim ? gaugeValue() : null, gaugeOk: GAUGE_OK, sinceJust: timeSeconds - justAt, sinceCollapse: timeSeconds - collapseAt, time: timeSeconds }
        : null,
    wellPreview:
      armed && pointer ? { x: pointer.x, y: pointer.y, radius: tuning.wellRadius, ok: wellSpotOk(pointer) } : null,
  });
  panel.update(curr, seed, armed);
  requestAnimationFrame(frame);
}

// 自動操作の確かめ用（開発用ページだけ。本番には含まれない）
declare global {
  interface Window {
    gravityLab?: { snapshot(): GameSnapshot; gravityLogLength(): number; mode(): LabMode };
  }
}
window.gravityLab = {
  snapshot: () => sim.getSnapshot(),
  gravityLogLength: () => sim.getGravityLog().length,
  mode: () => mode,
};

resize();
input.setEnabled(true);
const fromUrl = new URLSearchParams(location.search).get('mode');
setMode(fromUrl === 'grip' || fromUrl === 'well' || fromUrl === 'vortex' || fromUrl === 'none' ? fromUrl : 'tap');
requestAnimationFrame(frame);
