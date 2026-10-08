// 見本ページ: 画面（担当 D が自由に書き足してよい）。
// レイアウト、HUD、重ねて出す画面、保存を、ゲームを動かさずに確かめる。
// 押したボタンの意図（UiIntent）は右下に出るだけで、実際の画面遷移は起きない。

import '../styles/game.css';
import type { OverlayData, OverlayScreen, ResultView, Settings } from '../contracts/app';
import type { GameSnapshot, SimulationPort } from '../contracts/game';
import { SAMPLE_RECORDS, SAMPLE_RESULT, SAMPLE_RESULT_BEST, createAutoPlay, setupAllTiers } from '../fixtures';
import { DT } from '../game/constants';
import { createBoardRenderer } from '../render';
import { createRankingStore, createSaveStore } from '../storage';
import { createHud, createLayout, createOverlays } from '../ui';
import { addButton, addGroup, addSlider, log } from './demo-kit';

const saveStore = createSaveStore();
const ranking = createRankingStore(saveStore);
const renderer = createBoardRenderer(document.getElementById('board') as HTMLCanvasElement);
const hud = createHud(document.getElementById('hud')!, (intent) => log(`意図: ${JSON.stringify(intent)}`));

let settings: Settings = saveStore.load().settings;
let result: ResultView | undefined;
const data = (): OverlayData => ({
  bestScore: saveStore.load().bestScore,
  settings,
  playerName: saveStore.load().playerName,
  ...(result ? { result } : {}),
});

const overlays = createOverlays(document.getElementById('overlay-root')!, (intent) => {
  log(`意図: ${JSON.stringify(intent)}`);
  if (intent.kind === 'settingsChanged') settings = intent.settings;
  if (intent.kind === 'clearRecords') void ranking.clear();
});

createLayout(document.getElementById('app')!, (size) => {
  renderer.resize(size);
  log(`盤面の一辺: ${size}px`);
});

let auto = createAutoPlay(3, setupAllTiers(15));
let sim: SimulationPort = auto.sim;
let prev: GameSnapshot = sim.getSnapshot();
let heatOverride: number | null = null;
let acc = 0;
let last = performance.now();

function frame(now: number): void {
  const delta = Math.min((now - last) / 1000, 0.05);
  last = now;
  acc += delta;
  while (acc >= DT) {
    prev = sim.getSnapshot();
    for (const e of auto.step()) if ((e.chain ?? 1) >= 2) hud.showChain(e.chain!);
    acc -= DT;
  }
  const snap = sim.getSnapshot();
  const shown = heatOverride === null ? snap : { ...snap, heat: heatOverride };
  renderer.draw({ prev, curr: shown, alpha: acc / DT, timeSeconds: now / 1000, aim: null, guide: null, reducedMotion: false, timeMarkers: true, dimmed: overlays.current() !== null });
  hud.update(shown, saveStore.load().bestScore);
  requestAnimationFrame(frame);
}

addGroup('重ねる画面');
const screens: [string, OverlayScreen | null][] = [
  ['閉じる', null],
  ['タイトル', 'title'],
  ['遊び方', 'howto'],
  ['設定', 'settings'],
  ['一時停止', 'paused'],
];
for (const [label, screen] of screens) addButton(label, () => overlays.show(screen, data()));
addButton('結果', () => {
  result = SAMPLE_RESULT;
  overlays.show('result', data());
});
addButton('結果（ベスト更新）', () => {
  result = SAMPLE_RESULT_BEST;
  overlays.show('result', data());
});

addGroup('HUD');
addSlider('熱量', 0, 100, 15, (v) => (heatOverride = v));
addButton('熱量を自動に戻す', () => (heatOverride = null));
addButton('ヒント', () => hud.showToast('速すぎる衝突。同じ向きに回すと融合しやすい'));
addButton('連鎖 ×3', () => hud.showChain(3));
addButton('盤面をやり直す', () => {
  auto = createAutoPlay(Date.now() % 1000, setupAllTiers(15));
  sim = auto.sim;
  prev = sim.getSnapshot();
});

addGroup('記録');
addButton('見本の記録を 10 件入れる', async () => {
  await ranking.clear();
  for (const r of SAMPLE_RECORDS) await ranking.submit(r, []);
  log('見本の記録を入れた');
});
addButton('記録を全部消す', () => void ranking.clear());
addButton('ランキングページを開く', () => (location.href = '../ranking.html?from=result'));

requestAnimationFrame(frame);
