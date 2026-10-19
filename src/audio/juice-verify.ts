import type { GameEvent } from '../contracts/game';
import { sampleEvent } from '../fixtures';
import { eventTones } from './tones';
import { createVoices } from './voices';
import { masterVolume } from './tuning';
import { measureSound } from './analysis';

const RATE = 48000;
function channelMetrics(buffer: AudioBuffer) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => measureSound(buffer.getChannelData(c), buffer.sampleRate));
  return { peak: Math.max(...channels.map(c => c.peak)), clipped: channels.reduce((n, c) => n + c.clipped, 0),
    rms: Math.sqrt(channels.reduce((n, c) => n + c.rms ** 2, 0) / channels.length) };
}
/** 本番と同じ発音器を使い、単発・無音・混雑時を確認する見本専用の計測。 */
export async function verifyJuiceSound() {
  const records: string[] = [], buffers: { name: string; buffer: AudioBuffer }[] = [];
  for (const kind of ['launch', 'land', 'merge', 'supernova', 'overLimitStart', 'overLimitEnd', 'gameOver'] as const) {
    const context = new OfflineAudioContext(2, RATE * 2, RATE), voices = createVoices(context);
    voices.setVolume(masterVolume(100));
    const tones = eventTones(sampleEvent(kind, 4, 0, 0, 5)); voices.play(tones);
    const buffer = await context.startRendering();
    const metrics = channelMetrics(buffer);
    records.push(`${kind}: ${tones.length}層 / peak ${metrics.peak.toFixed(3)} / RMS ${metrics.rms.toFixed(4)} / 割れ ${metrics.clipped}`);
    if (kind === 'merge' || kind === 'supernova') buffers.push({ name: kind, buffer });
  }
  const context = new OfflineAudioContext(2, RATE * 4, RATE), voices = createVoices(context);
  voices.setVolume(masterVolume(100)); let peakVoices = 0, missing = 0;
  const kinds: GameEvent['kind'][] = ['launch', 'land', 'merge', 'merge', 'overLimitStart', 'supernova'];
  const play = (i: number) => {
    const tones = eventTones({ ...sampleEvent(kinds[i % kinds.length], 4, 0, 0, 5), sequence: i + 500 });
    missing += tones.length - voices.play(tones); peakVoices = Math.max(peakVoices, voices.count);
  };
  play(0);
  const pending = Array.from({ length: 59 }, (_, i) => context.suspend((i + 1) / 30).then(async () => { play(i + 1); await context.resume(); }));
  const buffer = await context.startRendering(); await Promise.all(pending);
  const metrics = channelMetrics(buffer);
  records.push(`混在30回/秒×2秒: 最大${peakVoices}/12音 / 成分欠け${missing} / 再利用${voices.stolenVoices} / 全ch peak ${metrics.peak.toFixed(3)} / 割れ${metrics.clipped} / 終了後${voices.count}音`);
  buffers.push({ name: 'mixed', buffer });
  const muted = new OfflineAudioContext(1, RATE, RATE), silence = createVoices(muted);
  silence.setVolume(0); silence.play(eventTones(sampleEvent('merge')));
  records.push(`音量0: peak ${measureSound((await muted.startRendering()).getChannelData(0), RATE).peak}`);
  return { text: records.join('\n'), buffers };
}

export function waveFile(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels, bytes = new ArrayBuffer(44 + buffer.length * channels * 2), view = new DataView(bytes);
  const word = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  word(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); word(8, 'WAVE'); word(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  word(36, 'data'); view.setUint32(40, bytes.byteLength - 44, true);
  for (let i = 0; i < buffer.length; i++) for (let c = 0; c < channels; c++) view.setInt16(44 + (i * channels + c) * 2, Math.max(-1, Math.min(1, buffer.getChannelData(c)[i])) * 32767, true);
  return new Blob([bytes], { type: 'audio/wav' });
}
