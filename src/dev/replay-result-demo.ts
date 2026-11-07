import './replay-demo.css';
import type { GameSnapshot } from '../contracts/game';
import { TICK_HZ, TIER_NAMES } from '../game/constants';
import { createBoardRenderer } from '../render';
import type { ResultMessage } from './replay-result.worker';
import type { ReplayHighlight } from '../replay';
import { saveReplayHandoff } from './replay-handoff';
import { annotateCause } from './replay-annotations';
import { createReplayPlayerAsync, parseReplay, serializeReplay } from '../replay';

const node = (id: string) => document.getElementById(id)!;
const canvas = node('board') as HTMLCanvasElement;
const renderer = createBoardRenderer(canvas);
const status = node('result-status');
let worker: Worker | null = null;
let snapshot: GameSnapshot | null = null;
let requestedAt = 0;
let lastResult: Extract<ResultMessage, { kind: 'result' }> | null = null;
let ready = false;
let restore: AbortController | null = null;
const RESULT_KEY = 'gravity-core.result-demo.last';
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
function button(label: string, action: () => void) {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
  b.addEventListener('click', action); node('demo-controls').append(b); return b;
}
function describe(h: ReplayHighlight): string {
  const name = h.kind === 'maxChain' ? `${h.value}連鎖` : h.kind === 'bestTier' ? `${TIER_NAMES[h.value]}が生まれた`
    : h.kind === 'supernova' ? '超新星' : h.kind === 'heatCritical' ? '臨界に達した' : '終了10秒前';
  return `${clock(h.tick / TICK_HZ)}　${name}`;
}
function draw() {
  if (!snapshot) return;
  renderer.draw({ prev: snapshot, curr: snapshot, alpha: 1, timeSeconds: snapshot.tick / TICK_HZ,
    reducedMotion: true, aimGuide: false, dimmed: false, aim: null });
  if (lastResult?.cause && snapshot === lastResult.cause.snapshot) annotateCause(canvas, snapshot, lastResult.cause);
}
function replayLink(text: string, tick: number, cause = false): HTMLAnchorElement {
  const a = document.createElement('a'); a.textContent = text;
  a.href = `./replay.html?from=result&tick=${tick}${cause ? '&cause=1' : ''}`; a.target = '_blank'; a.rel = 'noopener';
  a.addEventListener('click', (event) => {
    if (!lastResult || !saveReplayHandoff(lastResult.record)) {
      event.preventDefault(); status.textContent = '再生へ記録を渡せませんでした。結果はこのページに残っています。';
    }
  });
  return a;
}
function showResult(data: Extract<ResultMessage, { kind: 'result' }>, restored = false): void {
  lastResult = data; snapshot = data.cause?.snapshot ?? data.snapshot;
  node('result-view').hidden = false;
  renderer.resize(canvas.parentElement!.clientWidth); draw();
  finalBoard.disabled = false; causeBoard.disabled = data.cause === null;
  node('result-board-caption').textContent = data.cause ? `盤面は${clock(data.cause.heatRiseTick / TICK_HZ)}の越境時点。白い矢印が原因の天体です。` : '盤面は記録の終了時点です。';
  node('result-highlights').replaceChildren();
  for (const h of data.highlights) {
    const li = document.createElement('li'); li.append(replayLink(`${describe(h)} ／ 再生タブで開く`, h.tick)); node('result-highlights').append(li);
  }
  node('result-cause').textContent = data.cause
    ? `${clock(data.cause.heatRiseTick / TICK_HZ)}に限界線を越えた天体${data.cause.culprits.length}個があり、核熱量${data.cause.snapshot.heat.toFixed(0)}から${data.snapshot.heat.toFixed(0)}へ上がって終了しました。「熱が上がった瞬間」で原因の天体を白い矢印で確認できます。`
    : 'この記録はゲーム終了前です。負けた理由はありません。';
  if (data.cause) node('result-cause').append(document.createElement('br'), replayLink('越境の直前を別タブで再生', data.cause.heatRiseTick, true));
  node('result-time').textContent = `プレイ時間 ${clock(data.snapshot.tick / TICK_HZ)} ／ ${data.snapshot.score.toLocaleString()}点`;
  node('result-measure').textContent = '結果を描画しています。'; delete node('result-measure').dataset.ms;
  // レイアウトと盤面描画を含め、描画機会を一度またいでから測る。
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (lastResult !== data) return;
    const visibleMs = performance.now() - requestedAt;
    node('result-measure').textContent = restored
      ? `保存された記録を再検証して表示しました（${visibleMs.toFixed(1)} ms）。`
      : `結果ボタンから表示まで ${visibleMs.toFixed(1)} ms（基準 2,000 ms）。結果の整理 ${data.ms.toFixed(1)} ms。`;
    node('result-measure').dataset.ms = String(visibleMs); node('result-measure').dataset.computeMs = String(data.ms);
  }));
  node('result-replay').replaceChildren(replayLink('このプレイを別タブで再生・保存', 0));
  try {
    const saved = serializeReplay(data.record);
    if (!saved) throw new Error('unsupported');
    sessionStorage.setItem(RESULT_KEY, saved);
    node('result-save-status').textContent = 'このタブを再読み込みしても、最後の結果を復元できます。';
  } catch { node('result-save-status').textContent = 'このタブに結果を保存できません。ページを閉じる前に再生先で記録を保存してください。'; }
}
function resetWorker() { worker?.terminate(); worker = null; ready = false; finish.disabled = lastResult === null; cancel.disabled = true; }
button('6分以上のプレイを作る', () => {
  restore?.abort(); restore = null;
  resetWorker(); finish.disabled = true;
  status.textContent = '新しいプレイを作っています。前の結果は表示したまま残します。';
  try { worker = new Worker(new URL('./replay-result.worker.ts', import.meta.url), { type: 'module' }); }
  catch { status.textContent = '準備を開始できません。ブラウザを再読み込みしてください。'; resetWorker(); return; }
  const current = worker;
  cancel.disabled = false;
  worker.onmessage = (event: MessageEvent<ResultMessage>) => {
    if (worker !== current) return;
    const data = event.data;
    if (data.kind === 'progress') status.textContent = `${clock(data.seconds)}までゲームを進めています。`;
    else if (data.kind === 'recorded') {
      ready = true; finish.disabled = false; cancel.disabled = true;

      status.textContent = 'プレイが終わりました。「結果を見る」を押してください。';
    } else if (data.kind === 'result') {
      showResult(data);
      status.textContent = '見どころと負けた理由を表示しました。各時刻から、このプレイの再生へ進めます。';
    } else { resetWorker(); status.textContent = '記録を作れませんでした。もう一度お試しください。'; }
  };
  worker.onerror = () => { if (worker !== current) return; resetWorker(); status.textContent = '準備を開始できません。ブラウザを再読み込みしてください。'; };
  worker.postMessage('record');
});
const finish = button('結果を見る', () => {
  if (worker && ready) { requestedAt = performance.now(); worker.postMessage('finish'); }
  else if (lastResult) { requestedAt = performance.now(); showResult(lastResult); status.textContent = '前の結果を表示しました。'; }
});
const cancel = button('作成を中止', () => { resetWorker(); status.textContent = lastResult ? '作成を中止しました。前の結果をそのまま表示しています。' : 'プレイの作成を中止しました。'; });
const finalBoard = button('最後の盤面を見る', () => {
  if (!lastResult) return; snapshot = lastResult.snapshot; draw();
  node('result-board-caption').textContent = '盤面は記録の終了時点です。越境時点は「熱が上がった瞬間」で確認できます。';
});
const causeBoard = button('熱が上がった瞬間', () => {
  if (!lastResult?.cause) return; snapshot = lastResult.cause.snapshot; draw();
  node('result-board-caption').textContent = `盤面は${clock(lastResult.cause.heatRiseTick / TICK_HZ)}の越境時点。白い矢印が原因の天体です。`;
});
finalBoard.disabled = true; causeBoard.disabled = true;
resetWorker();
new ResizeObserver(() => { renderer.resize(canvas.parentElement!.clientWidth); draw(); }).observe(canvas.parentElement!);
window.addEventListener('pagehide', () => { worker?.terminate(); worker = null; ready = false; });
async function restoreSaved(): Promise<void> {
  let saved: string | null;
  try { saved = sessionStorage.getItem(RESULT_KEY); } catch { return; }
  if (!saved) return;
  const record = parseReplay(saved);
  if (!record) { status.textContent = '前の保存結果を読み込めません。新しいプレイを作れます。'; return; }
  const controller = new AbortController(); restore = controller;
  status.textContent = '前の結果の記録を確かめています。'; requestedAt = performance.now();
  const result = await createReplayPlayerAsync(record, { signal: controller.signal });
  if (restore !== controller) return;
  restore = null;
  if (!result.ok) { status.textContent = '前の結果を再現できません。新しいプレイを作れます。'; return; }
  showResult({ kind: 'result', record, highlights: result.player.highlights, cause: result.player.cause,
    ms: performance.now() - requestedAt, snapshot: result.player.seek(record.endTick) }, true);
  finish.disabled = false; status.textContent = '前の結果を復元しました。保存した記録は再検証済みです。';
}
void restoreSaved();
