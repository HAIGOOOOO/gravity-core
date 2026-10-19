import { createEffectsLayer, inspectEffects } from '../effects';
import { createEventEffects } from '../effects/events';
import { createEffectPool } from '../effects/pool';
import { drawPool } from '../effects/draw';
import { readTheme } from '../effects/theme';
import { LAYER_NAMES, layerCount, releaseTime } from '../effects/juice-model';
import { sampleEvent, setupAllTiers } from '../fixtures';
import { createSimulation } from '../game/simulation';
import { createBoardRenderer } from '../render';
import { drawBoardForeground } from '../render/foreground';
import { applyLogicalTransform } from '../shared/coords';
import { BOARD_SIZE, GROW_SECONDS, DT, TIER_RADIUS } from '../game/constants';
import type { GameEvent, GameSnapshot, Tier } from '../contracts/game';
import type { AimView } from '../contracts/app';
import { createAudioManager, inspectAudio } from '../audio';
import { verifyJuiceSound, waveFile } from '../audio/juice-verify';

const view = document.querySelector<HTMLCanvasElement>('#view')!;
const ctx = view.getContext('2d')!;
const readout = document.querySelector<HTMLElement>('#readout')!;
const timeline = document.querySelector<HTMLInputElement>('#timeline')!;
const reduced = document.querySelector<HTMLInputElement>('#reduced')!;
const compare = document.querySelector<HTMLInputElement>('#compare')!;
const soundEnabled = document.querySelector<HTMLInputElement>('#sound')!;
const audio = createAudioManager();
let audioPending: { event: GameEvent; snapshot: GameSnapshot }[] = [];
const soundUrls: string[] = [];
const board = document.createElement('canvas'), overlay = document.createElement('canvas');
const target = document.createElement('div'); target.style.width = '560px';
const renderer = createBoardRenderer(board); renderer.resize(560);
const effects = createEffectsLayer(overlay, target); effects.resize(560);
const snapshot = createSimulation(1, setupAllTiers()).getSnapshot();
let before = snapshot, after = snapshot, sceneAge = 0;
const baseCanvas = document.createElement('canvas'); baseCanvas.width = baseCanvas.height = overlay.width;
const baseCtx = baseCanvas.getContext('2d')!;
const theme = readTheme(overlay), pool = createEffectPool(), base = createEventEffects(pool, theme);
let chain = 1, tier: Tier = 1, nova = false, seed = 501, age = 0, playing = false, last = performance.now();
let mode: 'single' | 'ladder' | 'stress' = 'single', next = 0, fired = 0;
let samples: number[] = [], frameSamples: number[] = [], recording: MediaRecorder | null = null;
let videoUrl = '', recordingEnds = 0;
let current: GameEvent = sampleEvent('merge', tier, 110, -100, chain);

for (const name of LAYER_NAMES) { const li = document.createElement('li'); li.textContent = name; document.querySelector('#layers')!.append(li); }
function reset(): void {
  audio.suspend(); audioPending = [];
  if (soundEnabled.checked) { audio.unlock(); audio.setSettings({ sfx: true, volume: 70 }); audio.resume(); }
  effects.clear(); pool.clear(); base.clear(); age = 0; next = 0; fired = 0; samples = []; frameSamples = [];
  document.querySelector('#frames')!.replaceChildren();
  effects.setReducedMotion(reduced.checked); base.setReduced(reduced.checked);
}
function emit(level = chain): void {
  chain = level;
  const angle = -1 + fired * 1.35;
  const x = Math.cos(angle) * 180, y = Math.sin(angle) * 180, radius = TIER_RADIUS[tier] - 0.1;
  const contextBodies = snapshot.bodies.filter(body => body.tier !== tier && body.tier !== tier + 1
    && Math.hypot(body.x - x, body.y - y) > radius * 2 + body.radius + 30).map(body => ({ tier: body.tier, x: body.x, y: body.y }));
  const sim = createSimulation(seed, { bodies: [...contextBodies,
    { tier, x: x - Math.sin(angle) * radius, y: y + Math.cos(angle) * radius },
    { tier, x: x + Math.sin(angle) * radius, y: y - Math.cos(angle) * radius }] });
  before = sim.getSnapshot();
  const event = sim.stepFixed().find(event => event.kind === (nova ? 'supernova' : 'merge'));
  const preset = sampleEvent(nova ? 'supernova' : 'merge', tier, x, y, level);
  current = { ...preset, ...event, chain: level, scoreDelta: preset.scoreDelta, sequence: seed + fired };
  for (let i = 0; i < Math.ceil(GROW_SECONDS / DT); i++) sim.stepFixed();
  after = sim.getSnapshot(); sceneAge = 0;
  audioPending.push({ event: current, snapshot: after });
  effects.handleEvents([current], after); base.handle(current); fired++;
}
function begin(level: number, large: Tier = 1, supernova = false): void {
  chain = level; tier = large; nova = supernova; seed++; mode = 'single'; reset(); emit(); playing = true;
}
const comparisonAim: AimView = {
  originAngleRadians: -0.68, tier: 1, dragPx: 80, vx: -400, vy: 400, speed: Math.hypot(400, 400), straight: false, invalid: false,
  prediction: { valid: true, end: 'body', hitBodyId: null, willMerge: false,
    points: [{ x: 310, y: -250, t: 0 }, { x: 125, y: -70, t: 0.5 }] },
};
function drawGuides(): void {
  const k = 560 / BOARD_SIZE;
  ctx.save(); ctx.scale(k, k);
  drawBoardForeground(ctx, { prev: after, curr: after, alpha: 1, timeSeconds: 0, aim: comparisonAim, reducedMotion: reduced.checked, aimGuide: true, dimmed: false });
  ctx.restore();
}
function paint(): void {
  const scene = sceneAge < releaseTime({ chain, tier, nova }) ? before : after;
  renderer.draw({ prev: scene, curr: scene, alpha: 1, timeSeconds: 0, aim: null, reducedMotion: reduced.checked, aimGuide: true, dimmed: false });
  baseCtx.setTransform(1, 0, 0, 1, 0, 0); baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
  baseCtx.save(); applyLogicalTransform(baseCtx); base.draw(baseCtx); drawPool(baseCtx, pool, theme); baseCtx.restore();
  const started = performance.now(); effects.draw(); if (samples.length < 600) samples.push(performance.now() - started);
  ctx.fillStyle = '#080b13'; ctx.fillRect(0, 0, view.width, view.height);
  const panels = compare.checked ? 2 : 1;
  for (let i = 0; i < panels; i++) {
    ctx.save(); ctx.translate(i * 560, 0); ctx.fillStyle = '#c8d3df'; ctx.font = '600 16px system-ui'; ctx.fillText(i === 0 && compare.checked ? '前回' : `今回 — ${nova ? '超新星' : `${chain}連鎖`} / ${layerCount(chain, nova)}層`, 18, 25);
    ctx.save(); ctx.translate(280, 320);
    if (i > 0 || !compare.checked) { const matrix = new DOMMatrix(target.style.transform || undefined); ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f); }
    ctx.drawImage(board, -280, -280, 560, 560); ctx.drawImage(i === 0 && compare.checked ? baseCanvas : overlay, -280, -280, 560, 560);
    drawGuides(); ctx.restore(); ctx.restore();
  }
}
function percentile(values: number[], fraction: number): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0; }
function report(): void {
  const state = inspectEffects(overlay);
  readout.textContent = `${nova ? '超新星' : `${chain}連鎖`} / 構成 ${layerCount(chain, nova)}層 / 出来事 ${fired} / 生存 ${state.bursts}/8\n描画 p95 ${percentile(samples, 0.95).toFixed(2)}ms / 最大 ${Math.max(0, ...samples).toFixed(2)}ms / ${samples.length}標本 / 時間の依頼 ${effects.timeScale?.().toFixed(2) ?? '1'}\n圧縮 ${Math.round(releaseTime({ chain, tier, nova }) * 1000)}ms / カメラ ${target.style.transform ? '反応中' : '復帰済み'} / 表示間隔p95 ${percentile(frameSamples, 0.95).toFixed(1)}ms（比較ページ全体）`;
  document.querySelector('#time')!.textContent = `${age.toFixed(3)}秒`; timeline.value = `${Math.round(age * 60)}`;
}
function advance(dt: number): void { age += dt; sceneAge += dt; effects.update(dt); pool.update(dt); base.update(dt); }
function tick(now: number): void {
  const elapsed = (now - last) / 1000, dt = Math.min(0.05, elapsed); last = now;
  if (playing) {
    if (soundEnabled.checked && inspectAudio(audio).state === 'running') {
      for (const item of audioPending) audio.handleEvents([item.event], item.snapshot);
      audioPending = [];
    }
    frameSamples.push(elapsed * 1000); advance(dt);
    if (mode !== 'single' && age >= next && fired < (mode === 'ladder' ? 5 : 30)) {
      emit(mode === 'ladder' ? fired + 1 : chain); next += mode === 'ladder' ? 0.8 : 0.1;
    }
    if (age > (mode === 'single' ? 2.6 : 6)) { playing = false; paint(); report(); readout.textContent += '\n測定完了'; audio.suspend(); }
  }
  if (playing) { paint(); report(); }
  if (recording && now >= recordingEnds) { recording.stop(); recording = null; }
  requestAnimationFrame(tick);
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-chain]')) button.addEventListener('click', () => begin(Number(button.dataset.chain)));
document.querySelector('#giant')!.addEventListener('click', () => begin(1, 6));
document.querySelector('#nova')!.addEventListener('click', () => begin(5, 8, true));
document.querySelector('#ladder')!.addEventListener('click', () => { begin(1); mode = 'ladder'; next = 0.8; });
document.querySelector('#stress')!.addEventListener('click', () => { begin(5); mode = 'stress'; next = 0.1; });
document.querySelector('#stop')!.addEventListener('click', () => { playing = false; audio.suspend(); audioPending = []; effects.clear(); pool.clear(); base.clear(); paint(); report(); });
soundEnabled.addEventListener('change', () => { if (!soundEnabled.checked) { audio.suspend(); audioPending = []; } else { audio.unlock(); audio.resume(); } });
document.querySelector('#verify-sound')!.addEventListener('click', async event => {
  const button = event.currentTarget as HTMLButtonElement, output = document.querySelector('#sound-report')!;
  button.disabled = true; output.textContent = '本番と同じ発音器で、単発と混雑時の音を計算中…';
  try {
    const result = await verifyJuiceSound(); output.textContent = result.text;
    for (const url of soundUrls) URL.revokeObjectURL(url); soundUrls.length = 0;
    const files = document.querySelector('#sound-files')!; files.replaceChildren();
    for (const item of result.buffers) {
      const link = document.createElement('a'), url = URL.createObjectURL(waveFile(item.buffer)); soundUrls.push(url);
      link.href = url; link.download = `juice-${item.name}.wav`; link.textContent = `${item.name}の音を保存　`; files.append(link);
    }
  } catch (error) { output.textContent = `音の測定に失敗: ${String(error)}`; } finally { button.disabled = false; }
});
reduced.addEventListener('change', () => { effects.setReducedMotion(reduced.checked); base.setReduced(reduced.checked); paint(); report(); });
compare.addEventListener('change', () => { view.width = compare.checked ? 1120 : 560; paint(); });
timeline.addEventListener('input', () => { playing = false; const at = Number(timeline.value) / 60; reset(); emit(); for (let t = 0; t < at - 1e-6; t += 1 / 60) advance(Math.min(1 / 60, at - t)); paint(); report(); });
document.querySelector('#filmstrip')!.addEventListener('click', () => {
  playing = false; reset(); emit(); const root = document.querySelector('#frames')!; root.replaceChildren();
  for (let i = 0; i < 96; i++) { advance(1 / 60); paint(); const frame = document.createElement('canvas'); frame.width = 280; frame.height = 300;
    const g = frame.getContext('2d')!; g.drawImage(view, compare.checked ? 560 : 0, 0, 560, 600, 0, 0, 280, 300); g.fillStyle = '#fff'; g.font = '14px monospace'; g.fillText(`${age.toFixed(3)}s`, 8, 294); root.append(frame); }
  report();
});
document.querySelector('#record')!.addEventListener('click', () => {
  if (recording) return; compare.checked = true; view.width = 1120; begin(1); mode = 'ladder'; next = 0.8;
  const chunks: BlobPart[] = []; const stream = view.captureStream(60); const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
  recorder.ondataavailable = e => chunks.push(e.data);
  recorder.onstop = () => { stream.getTracks().forEach(track => track.stop()); if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrl = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })); const link = document.querySelector<HTMLAnchorElement>('#download')!;
    link.href = videoUrl; link.download = 'juice-comparison.webm'; link.hidden = false; readout.textContent += '\n比較動画の保存準備ができました。'; };
  recorder.start(); recording = recorder; recordingEnds = performance.now() + 6500;
});
paint(); requestAnimationFrame(tick);
