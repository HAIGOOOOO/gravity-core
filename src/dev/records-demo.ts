import './replay-demo.css';
import './records-demo.css';
import { TICK_HZ, TIER_NAMES } from '../game/constants';
import { createBoardRenderer } from '../render';
import { encodeReplayShare } from '../share';
import type { RecordSample } from './records.worker';

const node = (id: string) => document.getElementById(id)!;
const status = node('record-status');
const cancel = node('record-cancel') as HTMLButtonElement;
const view = node('record-result');
const renderer = createBoardRenderer(node('board') as HTMLCanvasElement);
let worker: Worker | null = null;
let selected: RecordSample | null = null;

function stop(): void {
  worker?.terminate();
  worker = null;
  cancel.hidden = true;
}

function draw(): void {
  if (!selected) return;
  const snap = selected.snapshot;
  renderer.draw({ prev: snap, curr: snap, alpha: 1, timeSeconds: snap.tick / TICK_HZ,
    reducedMotion: true, aimGuide: false, dimmed: false, aim: null });
}

function show(sample: RecordSample, duration: 30 | 120): void {
  selected = sample;
  const { snapshot, detail } = sample;
  node('record-score').textContent = `${detail.score.toLocaleString('ja-JP')}点`;
  node('record-tier').textContent = `到達した天体　${TIER_NAMES[detail.bestTier]}`;
  const seconds = Math.floor(detail.seconds);
  node('record-caption').textContent = `${Math.floor(seconds / 60)}分${seconds % 60}秒時点の盤面 ／ ${snapshot.phase === 'over' ? 'ゲーム終了' : 'プレイ途中'}。`;
  node('record-phase').textContent = `${Math.floor(seconds / 60)}分${seconds % 60}秒時点 ／ ${snapshot.phase === 'over' ? 'ゲーム終了' : '途中経過'}`;
  node('record-stats').replaceChildren();
  const stats: [string, string][] = [
    ['プレイ時間', `${Math.floor(seconds / 60)}分${seconds % 60}秒`],
    ['投げた回数', `${detail.launches}投`],
    ['合体', `${detail.merges}回`],
    ['最大連鎖', `${detail.maxChain}連鎖`],
    ['1投あたりの得点', `${detail.scorePerLaunch.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}点`],
  ];
  for (const [label, value] of stats) {
    const group = document.createElement('div');
    const name = document.createElement('dt'); name.textContent = label;
    const data = document.createElement('dd'); data.textContent = value;
    group.append(name, data); node('record-stats').append(group);
  }
  node('record-comparison').replaceChildren();
  const comparison: [string, string, string][] = [
    ['得点', snapshot.score.toLocaleString('ja-JP'), detail.score.toLocaleString('ja-JP')],
    ['到達した天体', TIER_NAMES[snapshot.bestTierThisRun], TIER_NAMES[detail.bestTier] ?? '不明'],
  ];
  for (const [label, actual, recorded] of comparison) {
    const row = document.createElement('tr');
    const heading = document.createElement('th'); heading.scope = 'row'; heading.textContent = label;
    const game = document.createElement('td'); game.textContent = actual;
    const stored = document.createElement('td'); stored.textContent = recorded;
    row.append(heading, game, stored); node('record-comparison').append(row);
  }
  (node('record-replay') as HTMLAnchorElement).href = `./replay.html#code=${encodeReplayShare(sample.record)}&sample=1`;
  view.hidden = false;
  renderer.resize(node('board').parentElement!.clientWidth);
  draw();
  const url = new URL(location.href);
  url.searchParams.set('sample', String(duration));
  try { history.replaceState(null, '', url); }
  catch { /* URLを書けない環境でも、開いている見本の照合は続ける。 */ }
  const matches = detail.score === snapshot.score && detail.bestTier === snapshot.bestTierThisRun;
  status.textContent = matches ? '照合しました。得点と到達した天体は、ゲームが計算した結果と一致しています。'
    : '記録がゲームの結果と一致しません。下の照合表を確認してください。';
}

function open(seconds: 30 | 120): void {
  stop();
  status.textContent = `${seconds === 30 ? '30秒' : '2分'}の見本を準備中…${selected ? '前の記録は表示したままです。' : ''}`;
  try {
    const current = new Worker(new URL('./records.worker.ts', import.meta.url), { type: 'module' });
    worker = current;
    cancel.hidden = false;
    current.onmessage = (event: MessageEvent<RecordSample>) => {
      if (worker !== current) return;
      stop(); show(event.data, seconds);
    };
    current.onerror = current.onmessageerror = () => {
      if (worker !== current) return;
      stop(); status.textContent = '記録を準備できませんでした。もう一度お試しください。';
    };
    current.postMessage(seconds);
  } catch {
    stop(); status.textContent = 'このブラウザでは記録を準備できませんでした。';
  }
}

node('record-short').addEventListener('click', () => open(30));
node('record-long').addEventListener('click', () => open(120));
cancel.addEventListener('click', () => {
  stop(); status.textContent = `準備を中止しました。${selected ? '前の記録はそのままです。' : ''}`;
});
new ResizeObserver(() => {
  if (view.hidden) return;
  renderer.resize(node('board').parentElement!.clientWidth); draw();
}).observe(node('board').parentElement!);
window.addEventListener('pagehide', stop);
const initial = Number(new URLSearchParams(location.search).get('sample'));
if (initial === 30 || initial === 120) open(initial);
