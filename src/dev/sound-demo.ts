import { DIRECTIONS, SCENES, LAB_RATE, LAB_SECONDS, renderDirection, type Direction, type SoundScene } from '../audio/directions';
import { comparisonGains, measureSound, spectrogram, type SoundMetrics } from '../audio/analysis';
import { metricsText, paintAnalysis } from '../audio/analysis-view';
import { paintSoundScene } from '../audio/scene-view';
import { mixSceneSequence, SCENE_SEQUENCE, SEQUENCE_SECONDS } from '../audio/sequence';
import { verifyLaunch } from '../audio/launch-verify';
import { createLaunchPreview } from '../audio/launch-preview';

type LabScene = SoundScene | 'sequence';
const LAB_SCENES: readonly LabScene[] = [...SCENES, 'sequence'];

const NAMES: Record<Direction, string> = { mineral: 'A 鉱石の共鳴', pressure: 'B 圧力と粒', musical: 'C 星を弾く' };
const SCENE_NAMES: Record<LabScene, string> = { drop: '落とす', impact: '当たる', small: '小さい合体', large: '大きい合体', limit: '限界を越えた', ending: '終了', sequence: '連続する出来事' };
const DESCRIPTIONS: Record<Direction, string> = { mineral: '金属の響きが集まり、ほどける。', pressure: '細かな粒がぶつかり、圧力が残る。', musical: '音階の短いフレーズで応える。' };
const DISPLAY_SECONDS: Record<LabScene, number> = { drop: 0.6, impact: 0.6, small: 0.9, large: 2, limit: 1.4, ending: 2, sequence: SEQUENCE_SECONDS };
const root = document.querySelector<HTMLElement>('#comparisons')!;
const status = document.querySelector<HTMLElement>('#status')!;
const compare = document.querySelector<HTMLButtonElement>('#compare')!;
const sceneSelect = document.querySelector<HTMLSelectElement>('#scene')!;
const volume = document.querySelector<HTMLInputElement>('#volume')!;
const preview = document.querySelector<HTMLCanvasElement>('#scene-preview')!;
const equalLevel = document.querySelector<HTMLInputElement>('#equal-level')!;
const allScenes = document.querySelector<HTMLInputElement>('#all-scenes')!;
const zoom = document.querySelector<HTMLInputElement>('#zoom')!;
const runtimePreview = document.querySelector<HTMLCanvasElement>('#runtime-preview')!;
const livePreview = createLaunchPreview(runtimePreview, document.querySelector('#runtime-live-report')!, () => Number(volume.value));
new ResizeObserver(([entry]) => { document.body.style.setProperty('--controls-height', `${entry.borderBoxSize[0].blockSize + 20}px`); }).observe(document.querySelector('#demo-controls')!);
type Entry = { buffer: AudioBuffer; card: HTMLElement; metrics: SoundMetrics; frames: Float64Array[]; canvas: HTMLCanvasElement;
  correction: number; correctedData: Float32Array; correctedMetrics: SoundMetrics; scene: LabScene; playhead: HTMLElement };
const entries = new Map<string, Entry>();
let context: AudioContext | undefined;
let gain: GainNode | undefined;
let active: AudioBufferSourceNode[] = [];
let playback = 0;
let generation = 0;
const cueItems = SCENE_SEQUENCE.map((cue, i) => {
  const item = document.createElement('li'); item.textContent = `${i + 1} ${cue.at.toFixed(2)}秒 ${SCENE_NAMES[cue.scene]}`;
  document.querySelector('#cue-strip')!.append(item); return item;
});

function selectScene(scene: LabScene): void {
  sceneSelect.value = scene;
  document.body.classList.toggle('sequence-mode', scene === 'sequence');
  document.querySelector<HTMLElement>('#sequence-guide')!.hidden = scene !== 'sequence';
  for (const row of root.querySelectorAll<HTMLElement>('.row')) row.hidden = !allScenes.checked && row.id !== scene;
  paintSoundScene(preview, scene === 'sequence' ? 'drop' : scene, 0);
}

function redraw(): void {
  for (const entry of entries.values()) {
    const corrected = equalLevel.checked;
    paintAnalysis(entry.canvas, corrected ? entry.correctedData : entry.buffer.getChannelData(0), entry.buffer.sampleRate,
      entry.frames, zoom.checked ? 0.3 : DISPLAY_SECONDS[entry.scene], corrected ? entry.correction : 1,
      entry.scene === 'sequence' ? SCENE_SEQUENCE.map((cue, i) => ({ at: cue.at, label: `${i + 1}` })) : []);
    const text = metricsText(corrected ? entry.correctedMetrics : entry.metrics);
    entry.card.querySelector('pre')!.textContent = entry.scene === 'sequence' ? text.replace('最大90%到達', '全体の最大90%の時刻').replace('減衰', '最後の可聴時刻') : text;
    const label = entry.card.querySelector('.level-info');
    if (label) label.textContent = corrected ? `${entry.scene === 'sequence' ? '連続全体' : '単発'}のRMS補正 ${(20 * Math.log10(entry.correction)).toFixed(1)}dB / 試聴音量前` : '元音量（単発と連続で基本音量共通）/ 試聴音量前';
  }
}

function showSummary(): void {
  const metrics = [...entries.values()].map(e => equalLevel.checked ? e.correctedMetrics : e.metrics);
  status.textContent = `18音＋連続3案の準備完了。${equalLevel.checked ? '比較補正後' : '元音量'}: 最大 ${Math.max(...metrics.map(m => m.peak)).toFixed(3)} / 割れ ${metrics.reduce((sum, m) => sum + m.clipped, 0)} / 最短90%到達 ${Math.min(...metrics.map(m => m.attackMs)).toFixed(1)}ms。`;
}

for (const scene of LAB_SCENES) {
  const option = document.createElement('option'); option.value = scene; option.textContent = SCENE_NAMES[scene]; sceneSelect.append(option);
}

function stop(): void {
  livePreview.stop();
  generation++;
  for (const source of active) { try { source.stop(); } catch { /* 終了済み */ } source.disconnect(); }
  active = [];
  cancelAnimationFrame(playback);
  for (const entry of entries.values()) entry.card.classList.remove('playing');
  for (const entry of entries.values()) entry.playhead.hidden = true;
  cueItems.forEach(item => item.removeAttribute('aria-current'));
  status.textContent = '停止しました。';
}

async function play(directions: readonly Direction[], scene: LabScene): Promise<void> {
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
    const gap = (scene === 'sequence' ? SEQUENCE_SECONDS : LAB_SECONDS) + 0.4;
    const sequence = directions.map((direction, i) => {
      const entry = entries.get(`${scene}-${direction}`)!;
      const source = context!.createBufferSource(); source.buffer = entry.buffer;
      const correction = context!.createGain(); correction.gain.value = equalLevel.checked ? entry.correction : 1;
      source.connect(correction).connect(gain!);
      const at = start + i * gap;
      source.start(at); source.onended = () => { source.disconnect(); correction.disconnect(); }; active.push(source);
      return { entry, at, direction };
    });
    const tick = () => {
      const now = context!.currentTime;
      for (const item of sequence) {
        const elapsed = now - item.at;
        item.entry.card.classList.toggle('playing', elapsed >= 0 && elapsed < item.entry.buffer.duration);
        const seconds = zoom.checked ? 0.3 : DISPLAY_SECONDS[scene];
        item.entry.playhead.hidden = elapsed < 0 || elapsed > seconds;
        item.entry.playhead.style.left = `${(39 + elapsed / seconds * (item.entry.canvas.width - 48)) / item.entry.canvas.width * 100}%`;
      }
      const item = sequence.find(item => now >= item.at && now < item.at + gap);
      if (item) {
        const elapsed = now - item.at;
        const cue = scene === 'sequence' ? [...SCENE_SEQUENCE].reverse().find(cue => cue.at <= elapsed) : undefined;
        paintSoundScene(preview, cue?.scene ?? (scene === 'sequence' ? 'drop' : scene), elapsed - (cue?.at ?? 0));
        const message = `${SCENE_NAMES[scene]} — ${NAMES[item.direction]} を再生中${cue ? ` — ${SCENE_NAMES[cue.scene]}` : ''}`;
        if (status.textContent !== message) status.textContent = message;
        cueItems.forEach((element, index) => {
          if (SCENE_SEQUENCE[index] === cue) element.setAttribute('aria-current', 'step'); else element.removeAttribute('aria-current');
        });
      }
      if (now < start + directions.length * gap) playback = requestAnimationFrame(tick);
      else { active = []; cueItems.forEach(item => item.removeAttribute('aria-current')); status.textContent = '再生が終わりました。'; }
    };
    tick();
  } catch (error) { stop(); status.textContent = `再生できません: ${error instanceof Error ? error.message : String(error)}`; }
}

document.querySelector('#stop')!.addEventListener('click', stop);
volume.addEventListener('input', () => {
  livePreview.setVolume();
  document.querySelector('output')!.textContent = `${volume.value}%`;
  if (gain && context) gain.gain.setTargetAtTime(Number(volume.value) / 100, context.currentTime, 0.015);
});
compare.addEventListener('click', () => { void play(DIRECTIONS, sceneSelect.value as LabScene); });
document.querySelector('#timeline')!.addEventListener('click', () => { void play(DIRECTIONS, 'sequence'); });
sceneSelect.addEventListener('change', () => { stop(); selectScene(sceneSelect.value as LabScene); });
allScenes.addEventListener('change', () => selectScene(sceneSelect.value as LabScene));
zoom.addEventListener('change', redraw);
equalLevel.addEventListener('change', () => { stop(); redraw(); showSummary(); });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-direction]')) {
  button.addEventListener('click', () => { void play([button.dataset.direction as Direction], sceneSelect.value as LabScene); });
}
paintSoundScene(preview, 'drop', 0);
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });

async function prepare(): Promise<void> {
  for (const scene of LAB_SCENES) {
    const section = document.createElement('section'); section.className = 'row'; section.id = scene;
    const heading = document.createElement('h2'); heading.textContent = `${LAB_SCENES.indexOf(scene) + 1}. ${SCENE_NAMES[scene]}`;
    const cards = document.createElement('div'); cards.className = 'cards'; section.append(heading, cards); root.append(section);
    for (const direction of DIRECTIONS) {
      let buffer: AudioBuffer;
      if (scene === 'sequence') {
        const samples = new Map(SCENES.map(single => [single, entries.get(`${single}-${direction}`)!.buffer.getChannelData(0)]));
        const mixed = mixSceneSequence(samples, LAB_RATE);
        buffer = new AudioBuffer({ numberOfChannels: 1, length: mixed.length, sampleRate: LAB_RATE });
        buffer.copyToChannel(mixed, 0);
      } else buffer = await renderDirection(direction, scene);
      const data = buffer.getChannelData(0), frames = spectrogram(data), metrics = measureSound(data, buffer.sampleRate, frames);
      const card = document.createElement('article'); card.id = `${scene}-${direction}`;
      const title = document.createElement('h3'); title.textContent = NAMES[direction];
      const description = document.createElement('p'); description.textContent = DESCRIPTIONS[direction];
      const button = document.createElement('button'); button.textContent = `${NAMES[direction]}を再生`;
      button.className = 'sample-play'; button.disabled = true;
      button.setAttribute('aria-label', `${SCENE_NAMES[scene]}・${NAMES[direction]}を再生`);
      button.addEventListener('click', () => { void play([direction], scene); });
      const plot = document.createElement('div'); plot.className = 'plot';
      const canvas = document.createElement('canvas'); canvas.width = scene === 'sequence' ? 900 : 420; canvas.height = scene === 'sequence' ? 280 : 240;
      const playhead = document.createElement('span'); playhead.className = 'playhead'; playhead.hidden = true;
      plot.append(canvas, playhead);
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${SCENE_NAMES[scene]}・${NAMES[direction]}の波形とスペクトログラム`);
      paintAnalysis(canvas, data, buffer.sampleRate, frames);
      const numbers = document.createElement('pre'); numbers.textContent = metricsText(metrics);
      card.append(title, description, button, plot, numbers); cards.append(card);
      entries.set(`${scene}-${direction}`, { buffer, card, metrics, frames, canvas, correction: 1, correctedData: data, correctedMetrics: metrics, scene, playhead });
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
  selectScene(sceneSelect.value as LabScene);
  redraw();
  compare.disabled = false;
  document.querySelector<HTMLButtonElement>('#timeline')!.disabled = false;
  document.querySelector<HTMLButtonElement>('#runtime-verify')!.disabled = false;
  document.querySelectorAll<HTMLButtonElement>('[data-direction], .sample-play').forEach(button => { button.disabled = false; });
  showSummary();
}
void prepare().catch(error => { status.textContent = `準備に失敗しました: ${String(error)}`; });

document.querySelector('#runtime-verify')!.addEventListener('click', () => { void showRuntimeStudy(); });
for (const [id, shots] of [['runtime-live', 1], ['runtime-repeat', 3]] as const) {
  document.getElementById(id)!.addEventListener('click', () => {
    stop(); document.querySelector<HTMLElement>('#runtime-study')!.hidden = false; runtimePreview.hidden = false;
    livePreview.start(shots); document.querySelector('#runtime-study')!.scrollIntoView({ block: 'start' });
  });
}
async function showRuntimeStudy(): Promise<void> {
  stop();
  const button = document.querySelector<HTMLButtonElement>('#runtime-verify')!;
  const section = document.querySelector<HTMLElement>('#runtime-study')!;
  const report = document.querySelector<HTMLElement>('#runtime-report')!;
  const samples = document.querySelector<HTMLElement>('#runtime-samples')!;
  section.hidden = false; button.disabled = true; report.textContent = '本番の音を測定しています…'; samples.replaceChildren();
  try {
    const result = await verifyLaunch();
    for (const sample of result.samples) {
      const card = document.createElement('article');
      const title = document.createElement('h3'); title.textContent = sample.label;
      const play = document.createElement('button'); play.textContent = 'この音を再生';
      play.addEventListener('click', () => { void playRuntimeSample(sample.buffer, sample.label).catch(error => { status.textContent = `再生できません: ${String(error)}`; }); });
      const canvas = document.createElement('canvas'); canvas.width = 420; canvas.height = 240;
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${sample.label}の波形とスペクトログラム`);
      const data = sample.buffer.getChannelData(0), frames = spectrogram(data);
      const multiple = sample.buffer.duration > 1;
      paintAnalysis(canvas, data, sample.buffer.sampleRate, frames, multiple ? sample.buffer.duration : 0.15, 1, [], 0.25);
      const numbers = document.createElement('pre');
      const text = metricsText(measureSound(data, sample.buffer.sampleRate, frames));
      numbers.textContent = multiple ? text.replace('最大90%到達', '全体の最大90%の時刻').replace('減衰', '最後の可聴時刻') : text;
      card.append(title, play, canvas, numbers); samples.append(card);
    }
    report.textContent = `信号開始 ${result.onsetMs.toFixed(2)}ms（振幅0.00001到達・出力機器の遅延は含まず）\n最大同時 ${result.maxVoices} / 60回で発音した成分 ${result.accepted} / 一部省略 ${result.partialEvents}回 / 全省略 ${result.silentEvents}回\n古い余韻を12msで短縮 ${result.trimmedTails}成分（通常の射出間隔は0.5秒以上）\n反復の波形差 ${result.changed ? 'あり' : 'なし'}（差のRMS/基準RMS ${result.relativeDifference.toFixed(3)}）\n初回/安定後の最大 ${result.coldPeak.toFixed(4)} / ${result.fullPeak.toFixed(4)}\n音量0の最大 ${result.mutedPeak} / 音量50%/100%のRMS ${result.halfVolumeRms.toFixed(5)} / ${result.fullVolumeRms.toFixed(5)}`;
    section.scrollIntoView({ block: 'start' });
  } catch (error) { report.textContent = `測定できません: ${String(error)}`; }
  finally { button.disabled = false; }
}

async function playRuntimeSample(buffer: AudioBuffer, label: string): Promise<void> {
  stop(); const current = generation;
  context ??= new AudioContext();
  if (!gain) { gain = context.createGain(); gain.connect(context.destination); }
  gain.gain.value = Number(volume.value) / 100;
  await context.resume();
  if (current !== generation) return;
  const source = context.createBufferSource(); source.buffer = buffer; source.connect(gain); active.push(source);
  source.onended = () => { source.disconnect(); active = active.filter(value => value !== source); if (current === generation) status.textContent = '再生が終わりました。'; };
  source.start(); status.textContent = `${label} を再生中`;
}
