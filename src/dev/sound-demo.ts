import { DIRECTIONS, SCENES, renderDirection, type Direction, type SoundScene } from '../audio/directions';
import { comparisonGains, measureSound, spectrogram, type SoundMetrics } from '../audio/analysis';
import { metricsText, paintAnalysis } from '../audio/analysis-view';
import { paintSoundScene } from '../audio/scene-view';

const NAMES: Record<Direction, string> = { mineral: 'A 鉱石の共鳴', pressure: 'B 圧力と粒', musical: 'C 星を弾く' };
const SCENE_NAMES: Record<SoundScene, string> = { drop: '落とす', impact: '当たる', small: '小さい合体', large: '大きい合体', limit: '限界を越えた', ending: '終了' };
const DESCRIPTIONS: Record<Direction, string> = { mineral: '金属の響きが集まり、ほどける。', pressure: '細かな粒がぶつかり、圧力が残る。', musical: '音階の短いフレーズで応える。' };
const DISPLAY_SECONDS: Record<SoundScene, number> = { drop: 0.6, impact: 0.6, small: 0.9, large: 2, limit: 1.4, ending: 2 };
const root = document.querySelector<HTMLElement>('#comparisons')!;
const status = document.querySelector<HTMLElement>('#status')!;
const compare = document.querySelector<HTMLButtonElement>('#compare')!;
const sceneSelect = document.querySelector<HTMLSelectElement>('#scene')!;
const volume = document.querySelector<HTMLInputElement>('#volume')!;
const preview = document.querySelector<HTMLCanvasElement>('#scene-preview')!;
const equalLevel = document.querySelector<HTMLInputElement>('#equal-level')!;
const allScenes = document.querySelector<HTMLInputElement>('#all-scenes')!;
const zoom = document.querySelector<HTMLInputElement>('#zoom')!;
type Entry = { buffer: AudioBuffer; card: HTMLElement; metrics: SoundMetrics; frames: Float64Array[]; canvas: HTMLCanvasElement;
  correction: number; correctedData: Float32Array; correctedMetrics: SoundMetrics; scene: SoundScene };
const entries = new Map<string, Entry>();
let context: AudioContext | undefined;
let gain: GainNode | undefined;
let active: AudioBufferSourceNode[] = [];
let playback = 0;
let generation = 0;

function selectScene(scene: SoundScene): void {
  sceneSelect.value = scene;
  for (const row of root.querySelectorAll<HTMLElement>('.row')) row.hidden = !allScenes.checked && row.id !== scene;
  paintSoundScene(preview, scene, 0);
}

function redraw(): void {
  for (const entry of entries.values()) {
    const corrected = equalLevel.checked;
    paintAnalysis(entry.canvas, corrected ? entry.correctedData : entry.buffer.getChannelData(0), entry.buffer.sampleRate,
      entry.frames, zoom.checked ? 0.3 : DISPLAY_SECONDS[entry.scene], corrected ? entry.correction : 1);
    entry.card.querySelector('pre')!.textContent = metricsText(corrected ? entry.correctedMetrics : entry.metrics);
    const label = entry.card.querySelector('.level-info');
    if (label) label.textContent = corrected ? `比較補正後 ${(20 * Math.log10(entry.correction)).toFixed(1)}dB / 試聴音量前` : '元音量 / 試聴音量前';
  }
}

function showSummary(): void {
  const metrics = [...entries.values()].map(e => equalLevel.checked ? e.correctedMetrics : e.metrics);
  status.textContent = `18音の準備完了。${equalLevel.checked ? '比較補正後' : '元音量'}: 最大 ${Math.max(...metrics.map(m => m.peak)).toFixed(3)} / 割れ ${metrics.reduce((sum, m) => sum + m.clipped, 0)} / 最短90%到達 ${Math.min(...metrics.map(m => m.attackMs)).toFixed(1)}ms。`;
}

for (const scene of SCENES) {
  const option = document.createElement('option'); option.value = scene; option.textContent = SCENE_NAMES[scene]; sceneSelect.append(option);
}

function stop(): void {
  generation++;
  for (const source of active) { try { source.stop(); } catch { /* 終了済み */ } source.disconnect(); }
  active = [];
  cancelAnimationFrame(playback);
  for (const entry of entries.values()) entry.card.classList.remove('playing');
  status.textContent = '停止しました。';
}

async function play(directions: readonly Direction[], scene: SoundScene): Promise<void> {
  stop();
  selectScene(scene);
  const current = generation;
  try {
    context ??= new AudioContext();
    if (!gain) { gain = context.createGain(); gain.connect(context.destination); }
    gain.gain.value = Number(volume.value) / 100;
    await context.resume();
    if (current !== generation) return;
    const start = context.currentTime + 0.025;
    const sequence = directions.map((direction, i) => {
      const entry = entries.get(`${scene}-${direction}`)!;
      const source = context!.createBufferSource(); source.buffer = entry.buffer;
      const correction = context!.createGain(); correction.gain.value = equalLevel.checked ? entry.correction : 1;
      source.connect(correction).connect(gain!);
      const at = start + i * 2.8;
      source.start(at); source.onended = () => { source.disconnect(); correction.disconnect(); }; active.push(source);
      return { entry, at, direction };
    });
    const tick = () => {
      const now = context!.currentTime;
      for (const item of sequence) item.entry.card.classList.toggle('playing', now >= item.at && now < item.at + item.entry.buffer.duration);
      const item = sequence.find(item => now >= item.at && now < item.at + 2.8);
      if (item) status.textContent = `${SCENE_NAMES[scene]} — ${NAMES[item.direction]} を再生中`;
      if (item) paintSoundScene(preview, scene, now - item.at);
      if (now < start + directions.length * 2.8) playback = requestAnimationFrame(tick);
      else { active = []; status.textContent = '再生が終わりました。'; }
    };
    tick();
  } catch (error) { stop(); status.textContent = `再生できません: ${error instanceof Error ? error.message : String(error)}`; }
}

document.querySelector('#stop')!.addEventListener('click', stop);
volume.addEventListener('input', () => {
  document.querySelector('output')!.textContent = `${volume.value}%`;
  if (gain && context) gain.gain.setTargetAtTime(Number(volume.value) / 100, context.currentTime, 0.015);
});
compare.addEventListener('click', () => { void play(DIRECTIONS, sceneSelect.value as SoundScene); });
sceneSelect.addEventListener('change', () => { stop(); selectScene(sceneSelect.value as SoundScene); });
allScenes.addEventListener('change', () => selectScene(sceneSelect.value as SoundScene));
zoom.addEventListener('change', redraw);
equalLevel.addEventListener('change', () => { stop(); redraw(); showSummary(); });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-direction]')) {
  button.addEventListener('click', () => { void play([button.dataset.direction as Direction], sceneSelect.value as SoundScene); });
}
paintSoundScene(preview, 'drop', 0);
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });

async function prepare(): Promise<void> {
  for (const scene of SCENES) {
    const section = document.createElement('section'); section.className = 'row'; section.id = scene;
    const heading = document.createElement('h2'); heading.textContent = `${SCENES.indexOf(scene) + 1}. ${SCENE_NAMES[scene]}`;
    const cards = document.createElement('div'); cards.className = 'cards'; section.append(heading, cards); root.append(section);
    for (const direction of DIRECTIONS) {
      const buffer = await renderDirection(direction, scene);
      const data = buffer.getChannelData(0), frames = spectrogram(data), metrics = measureSound(data, buffer.sampleRate, frames);
      const card = document.createElement('article'); card.id = `${scene}-${direction}`;
      const title = document.createElement('h3'); title.textContent = NAMES[direction];
      const description = document.createElement('p'); description.textContent = DESCRIPTIONS[direction];
      const button = document.createElement('button'); button.textContent = `${NAMES[direction]}を再生`;
      button.className = 'sample-play'; button.disabled = true;
      button.setAttribute('aria-label', `${SCENE_NAMES[scene]}・${NAMES[direction]}を再生`);
      button.addEventListener('click', () => { void play([direction], scene); });
      const canvas = document.createElement('canvas'); canvas.width = 420; canvas.height = 240;
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${SCENE_NAMES[scene]}・${NAMES[direction]}の波形とスペクトログラム`);
      paintAnalysis(canvas, data, buffer.sampleRate, frames);
      const numbers = document.createElement('pre'); numbers.textContent = metricsText(metrics);
      card.append(title, description, button, canvas, numbers); cards.append(card);
      entries.set(`${scene}-${direction}`, { buffer, card, metrics, frames, canvas, correction: 1, correctedData: data, correctedMetrics: metrics, scene });
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    const sceneEntries = DIRECTIONS.map(direction => entries.get(`${scene}-${direction}`)!);
    comparisonGains(sceneEntries.map(e => e.metrics)).forEach((value, i) => {
      sceneEntries[i].correction = value;
      const scaled = Float32Array.from(sceneEntries[i].buffer.getChannelData(0), sample => sample * value);
      sceneEntries[i].correctedData = scaled;
      sceneEntries[i].correctedMetrics = measureSound(scaled, sceneEntries[i].buffer.sampleRate, sceneEntries[i].frames);
      const correction = document.createElement('p'); correction.className = 'level-info';
      sceneEntries[i].card.append(correction);
    });
  }
  selectScene(sceneSelect.value as SoundScene);
  redraw();
  compare.disabled = false;
  document.querySelectorAll<HTMLButtonElement>('[data-direction], .sample-play').forEach(button => { button.disabled = false; });
  showSummary();
}
void prepare().catch(error => { status.textContent = `準備に失敗しました: ${String(error)}`; });
