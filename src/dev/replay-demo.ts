import './replay-demo.css';
import type { GameEvent, GameSnapshot } from '../contracts/game';
import { BOARD_SIZE, HEAT_MAX, TICK_HZ, TIER_NAMES } from '../game/constants';
import { at, createAutoPlay } from '../fixtures';
import { createSimulation, type SimulationSetup } from '../game/simulation';
import { createBoardRenderer } from '../render';
import { annotateCause, annotateMerge } from './replay-annotations';
import { createReplaySavePanel } from './replay-save-panel';
import { LONG_REPLAY_TEXT } from './replay-long-sample';
import {
  createReplayPlayerAsync, createReplayRecord, parseReplay,
  type ReplayPlayer, type ReplayRecord, type ReplayHighlight,
} from '../replay';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = element<HTMLCanvasElement>('board');
const renderer = createBoardRenderer(canvas);
const timeline = element<HTMLInputElement>('timeline');
const status = element('status');
let player: ReplayPlayer | null = null;
let playing = false;
let speed = 1;
let fractionalTicks = 0;
let lastTime = performance.now();
let showingCause = false;
let causeStop: number | null = null;
let previousSnapshot: GameSnapshot | null = null;
let mergeEvents: readonly GameEvent[] = [];
let preparation: AbortController | null = null;
let selectedHighlight: ReplayHighlight | null = null;
let zoomed = false;
function renderMarkers(): void {
  const track = element('timeline-markers'); track.replaceChildren();
  if (!player) return;
  const min = Number(timeline.min), max = Number(timeline.max);
  const groups: ReplayHighlight[][] = [];
  for (const h of player.highlights.filter((h) => h.tick >= min && h.tick <= max)) {
    const group = groups[groups.length - 1];
    if (group && (h.tick - group[0]!.tick) / Math.max(1, max - min) * canvas.clientWidth < 44) group.push(h);
    else groups.push([h]);
  }
  for (const group of groups) {
    const h = group[0]!;
    const marker = document.createElement('button'); marker.type = 'button';
    marker.textContent = group.length > 1 ? `${group.length}件` : clock(h.tick);
    marker.style.left = `${(h.tick - min) / Math.max(1, max - min) * 100}%`;
    marker.setAttribute('aria-label', group.map((h) => `${clock(h.tick)} ${highlightLabel(h)}`).join('、') + 'の周辺へ移動して拡大');
    marker.addEventListener('click', () => zoomAt(h.tick, true)); track.append(marker);
  }
}
function zoomAt(tick: number, move = false): void {
  if (!player) return;
  timeline.min = String(Math.max(0, tick - 5 * TICK_HZ));
  timeline.max = String(Math.min(player.endTick, tick + 5 * TICK_HZ));
  zoomed = true; playing = false;
  if (move) seek(tick); else draw();
  renderMarkers();
  element('timeline-window').textContent = `拡大範囲 ${clock(Number(timeline.min))} 〜 ${clock(Number(timeline.max))}`;
  zoomButton.textContent = '時間軸を全体に戻す';
}
function resetRange(): void {
  if (!player) return;
  zoomed = false; timeline.min = '0'; timeline.max = String(player.endTick);
  zoomButton.textContent = '再生位置の周辺を拡大';
  element('timeline-window').textContent = `全体 0:00 〜 ${clock(player.endTick)}`; renderMarkers();
}
const disabledBefore = new Map<HTMLInputElement | HTMLButtonElement, boolean>();
function busy(on: boolean, name = ''): void {
  document.querySelector('.replay-layout')!.setAttribute('aria-busy', String(on));
  cancelButton.style.visibility = on ? 'visible' : 'hidden';
  element('preparation-note').textContent = on ? `${name}を準備しています。盤面は前の記録です。` : '準備完了。再生できます。';
  if (on && disabledBefore.size === 0) {
    document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('#record-jumps button, #highlight-nav button, #transport button, #save-controls button, #export-controls button, #import-controls button, #import-record, #record-file, #timeline').forEach((control) => {
      disabledBefore.set(control, control.disabled); control.disabled = true;
    });
  } else if (!on) {
    for (const [control, disabled] of disabledBefore) control.disabled = disabled;
    disabledBefore.clear();
  }
}

function button(parent: string, label: string, action: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', action);
  element(parent).append(b);
  return b;
}
const clock = (tick: number) => {
  const seconds = Math.floor(tick / TICK_HZ);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
function highlightLabel(h: ReplayHighlight): string {
  switch (h.kind) {
    case 'maxChain': return `${h.value} 連鎖`;
    case 'bestTier': return `${TIER_NAMES[h.value]}が生まれた`;
    case 'supernova': return `超新星 ${h.value} 回目`;
    case 'heatCritical': return '臨界に達した瞬間';
    case 'beforeGameOver': return '終了する前から見る';
  }
}
function draw(): void {
  if (!player) return;
  const snap = player.snapshot();
  previousHighlightButton.disabled = preparation !== null || !adjacentHighlight(-1);
  nextHighlightButton.disabled = preparation !== null || !adjacentHighlight(1);
  if (zoomed && (snap.tick < Number(timeline.min) || snap.tick > Number(timeline.max))) resetRange();
  renderer.draw({ prev: snap, curr: snap, alpha: 1, timeSeconds: snap.tick / TICK_HZ,
    aim: null, reducedMotion: true, aimGuide: false, dimmed: false });
  if (showingCause && player.cause) annotateCause(canvas, snap, player.cause);
  element('event-context').textContent = showingCause ? '' : annotateMerge(canvas, snap, previousSnapshot ?? snap, mergeEvents);
  element('time').textContent = `${clock(snap.tick)} / ${clock(player.endTick)}`;
  timeline.value = String(snap.tick);
  timeline.setAttribute('aria-valuetext', `${clock(snap.tick)} / ${clock(player.endTick)}`);
  element('score').textContent = `${snap.score.toLocaleString()} 点`;
  element('heat').textContent = `核熱量 ${snap.heat.toFixed(0)} / ${HEAT_MAX}`;
  element('cause-context').textContent = showingCause && player.cause
    ? (snap.tick < player.cause.heatRiseTick ? '熱が上がる直前を0.5倍で再生。白い矢印の天体が限界線へ向かいます。' : '白い矢印の天体が限界線を越え、核熱量が上がり始めました。') : '';
  if (playing) status.textContent = `${clock(snap.tick)} を再生中（${speed} 倍）`;
  playButton.textContent = playing ? '一時停止' : snap.tick === player.endTick ? 'もう一度再生' : '再生';
}
function seek(tick: number, preserveHighlight = false): void {
  if (!player) return;
  if (!preserveHighlight) { selectedHighlight = null; element('selected-highlight').textContent = ''; }
  fractionalTicks = 0;
  const started = performance.now();
  previousSnapshot = null;
  player.seek(tick);
  mergeEvents = player.events;
  status.dataset.seekMs = (performance.now() - started).toFixed(1);
  status.textContent = `${clock(player.tick)} を表示しています。`;
  draw();
}
async function openRecord(record: ReplayRecord, name: string): Promise<boolean | null> {
  const started = performance.now();
  preparation?.abort();
  const controller = new AbortController(); preparation = controller;
  playing = false; busy(true, name);
  status.textContent = '記録を準備しています。待たずに中止したり、別の記録を選べます。';
  const result = await createReplayPlayerAsync(record, { signal: controller.signal });
  if (preparation !== controller) return null;
  preparation = null; busy(false);
  if (!result.ok) {
    element('preparation-note').textContent = result.reason === 'cancelled' ? '準備を中止しました。' : 'この記録の準備はできませんでした。';
    if (result.reason === 'cancelled') { status.textContent = '準備を中止しました。前の記録と保存はそのままです。'; return null; }
    status.textContent = result.reason === 'rulesMismatch' ? '今のルールと違うため、この記録は再生できません。'
      : result.reason === 'unavailable' ? '再生の準備を開始できません。ブラウザを再読み込みしてから試してください。'
      : '記録を再現できません。元の記録を確認してください。';
    return false;
  }
  player = result.player;
  selectedHighlight = null;
  playing = false; showingCause = false; fractionalTicks = 0; causeStop = null; mergeEvents = []; previousSnapshot = null;
  resetRange();
  element('sample-name').textContent = name;
  element('highlights').replaceChildren();
  selectedHighlight = null;
  element('selected-highlight').textContent = '';
  for (const h of player.highlights) button('highlights', `${clock(h.tick)}　${highlightLabel(h)}`, () => playHighlight(h));
  renderMarkers();
  document.querySelectorAll<HTMLButtonElement>('#sample-controls button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.recordName === name));
  });
  if (player.highlights.length === 0) element('highlights').textContent = 'この記録では、まだ合体は起きていません。';
  const cause = player.cause;
  element('cause').textContent = cause
    ? `${clock(cause.heatRiseTick)} に限界リングを越え、熱量が上がりました。白い輪と矢印でその時の天体を示します。`
    : 'この記録は、ゲームが終わる前までのプレイです。';
  causeButton.disabled = !cause;
  element('cause-availability').textContent = cause ? '' : 'ゲーム終了前の記録なので、負けた原因の表示はありません。';
  savePanel.refresh();
  status.dataset.openMs = (performance.now() - started).toFixed(0);
  status.textContent = '記録を開きました。再生を押すと始まります。';
  draw();
  return true;
}
function sample(defeat: boolean): void {
  if (!defeat) {
    const auto = createAutoPlay(7);
    for (let i = 0; i < 30 * TICK_HZ && auto.sim.getSnapshot().phase === 'active'; i++) auto.step();
    openRecord(createReplayRecord(auto.sim), '見本：30 秒の合体');
    return;
  }
  const setup: SimulationSetup = { bodies: [at(7, 130, 0), at(6, 280, 0), at(5, 400, 0)], heat: 50, bestTier: 8 };
  const sim = createSimulation(1, setup);
  for (let i = 0; i < 20 * TICK_HZ && sim.getSnapshot().phase === 'active'; i++) sim.stepFixed();
  openRecord(createReplayRecord(sim, { setup }), '見本：山が限界を越えたプレイ');
}
const shortButton = button('sample-controls', '合体の記録', () => sample(false));
shortButton.dataset.recordName = '見本：30 秒の合体';
const longButton = button('sample-controls', '10分の記録', () => {
  const record = parseReplay(LONG_REPLAY_TEXT);
  if (record) void openRecord(record, '見本：10分の記録（最初の30秒のみ投入）');
  else status.textContent = 'この見本は現在の記録形式に対応していません。';
});
longButton.dataset.recordName = '見本：10分の記録（最初の30秒のみ投入）';
const defeatButton = button('sample-controls', '負けた記録', () => sample(true));
defeatButton.dataset.recordName = '見本：山が限界を越えたプレイ';
const cancelButton = button('preparation-controls', '準備を中止', () => preparation?.abort());
cancelButton.style.visibility = 'hidden';
const causeButton = button('record-jumps', '熱が上がった場所へ', () => {
  if (!player?.cause) return;
  showingCause = true; speed = .5;
  for (const entry of speedButtons) entry.button.setAttribute('aria-pressed', String(entry.value === speed));
  seek(Math.max(0, player.cause.heatRiseTick - TICK_HZ));
  causeStop = Math.min(player.endTick, player.cause.heatRiseTick + TICK_HZ);
  playing = true; lastTime = performance.now(); draw();
});
button('record-jumps', '最後の10秒を再生', () => {
  if (!player) return;
  showingCause = false; playing = true;
  seek(Math.max(0, player.endTick - 10 * TICK_HZ));
});
function playHighlight(h: ReplayHighlight): void {
  selectedHighlight = h; showingCause = false; causeStop = null; playing = true; speed = .5;
  for (const entry of speedButtons) entry.button.setAttribute('aria-pressed', String(entry.value === speed));
  seek(Math.max(0, h.tick - (h.kind === 'beforeGameOver' ? 0 : 2 * TICK_HZ)), true);
  const suffix = h === player?.highlights[player.highlights.length - 1] ? '（最後の見どころ）' : '';
  element('selected-highlight').textContent = `${clock(h.tick)} ${highlightLabel(h)}へ、直前から再生 ${suffix}`;
}
function adjacentHighlight(direction: -1 | 1): ReplayHighlight | undefined {
  if (!player) return undefined;
  const index = selectedHighlight ? player.highlights.indexOf(selectedHighlight) : -1;
  const next = index >= 0 ? player.highlights[index + direction]
    : direction > 0 ? player.highlights.find((h) => h.tick > player!.tick)
    : [...player.highlights].reverse().find((h) => h.tick < player!.tick);
  return next;
}
const playButton = button('transport', '再生', () => {
  if (!player) return;
  if (player.tick === player.endTick) seek(0);
  causeStop = null; playing = !playing; lastTime = performance.now(); draw();
});
const zoomButton = button('transport', '再生位置の周辺を拡大', () => {
  if (!player) return;
  if (zoomed) resetRange(); else zoomAt(player.tick);
});
button('transport', '先頭', () => { playing = false; showingCause = false; seek(0); });
const previousHighlightButton = button('highlight-nav', '前の見どころを再生', () => { const h = adjacentHighlight(-1); if (h) playHighlight(h); });
const nextHighlightButton = button('highlight-nav', '次の見どころを再生', () => { const h = adjacentHighlight(1); if (h) playHighlight(h); });
button('transport', '5 秒戻る', () => { playing = false; seek((player?.tick ?? 0) - 5 * TICK_HZ); });
const speedButtons = [.5, 1, 2, 4, 8].map((value) => {
  const b = button('transport', `${value} 倍`, () => {
    speed = value;
    for (const entry of speedButtons) entry.button.setAttribute('aria-pressed', String(entry.value === speed));
  });
  b.setAttribute('aria-pressed', String(value === speed));
  return { value, button: b };
});
timeline.addEventListener('input', () => { selectedHighlight = null; element('selected-highlight').textContent = ''; playing = false; showingCause = false; causeStop = null; seek(Number(timeline.value)); });
const savePanel = createReplaySavePanel({ getPlayer: () => player, openRecord });
// Canvas 自身を監視すると、枠線を引いた幅で縮み続けるため親の幅で決める。
let boardWidth = 0;
new ResizeObserver(() => {
  const width = canvas.parentElement!.clientWidth;
  if (width === boardWidth) return;
  boardWidth = width;
  renderer.resize(width); draw();
}).observe(canvas.parentElement!);
function frame(now: number): void {
  if (player && playing) {
    fractionalTicks += Math.min((now - lastTime) / 1000, .1) * TICK_HZ * speed;
    const ticks = Math.floor(fractionalTicks);
    fractionalTicks -= ticks;
    if (ticks) {
      const before = player.snapshot();
      player.step(causeStop === null ? ticks : Math.min(ticks, causeStop - player.tick));
      if (player.events.some((event) => event.kind === 'merge' || event.kind === 'supernova')) {
        previousSnapshot = before; mergeEvents = player.events;
      }
      if (causeStop !== null && player.tick >= causeStop) { playing = false; causeStop = null; status.textContent = '熱が上がり始めた直後です。'; }
      if (player.tick === player.endTick) { playing = false; status.textContent = '記録の最後です。もう一度再生できます。'; }
      draw();
    }
  }
  lastTime = now;
  requestAnimationFrame(frame);
}
// 非表示のタブで時間を飛ばさず、帰ってきた時も同じ場所から再生する。
document.addEventListener('visibilitychange', () => { if (document.hidden) { playing = false; draw(); } });
renderer.resize(Math.min(620, BOARD_SIZE));
sample(false);
requestAnimationFrame(frame);
