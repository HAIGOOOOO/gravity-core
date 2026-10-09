import { sampleEvent } from '../fixtures';
import { eventTones } from './tones';
import { AUDIO } from './tuning';
import { createVoices } from './voices';

const SAMPLE_RATE = 48000;
const VERIFY_SECONDS = 2;

/** 見本専用。同じ発振器・音量・コンプレッサーで波形を作り、無音や飽和を検出する。 */
export async function verifySynthesis() {
  const results: { kind: string; peak: number; rms: number; silentLead: boolean }[] = [];
  for (const kind of ['launch', 'land', 'merge', 'supernova', 'overLimitStart', 'overLimitEnd'] as const) {
    const context = new OfflineAudioContext(1, SAMPLE_RATE * VERIFY_SECONDS, SAMPLE_RATE);
    const voices = createVoices(context);
    voices.setVolume(AUDIO.master);
    voices.play(eventTones(sampleEvent(kind, 7, 0, 0, 5)));
    const buffer = await context.startRendering();
    const data = buffer.getChannelData(0);
    let energy = 0;
    let peak = 0;
    let lead = 0;
    for (let i = 0; i < data.length; i++) {
      peak = Math.max(peak, Math.abs(data[i]));
      energy += data[i] * data[i];
      if (i < SAMPLE_RATE * AUDIO.novaSilence) lead += data[i] * data[i];
    }
    results.push({ kind, peak, rms: Math.sqrt(energy / data.length), silentLead: lead === 0 });
  }
  // ブラウザの本物のノードを使って、予約した音も 12 個で止めることを確かめる。
  const context = new OfflineAudioContext(1, SAMPLE_RATE * VERIFY_SECONDS, SAMPLE_RATE);
  const voices = createVoices(context);
  voices.setVolume(AUDIO.master);
  for (let i = 0; i < 100; i++) voices.play(eventTones(sampleEvent('merge')));
  const capped = voices.count === AUDIO.maxVoices;
  voices.stop();
  const cleared = voices.count === 0;
  await context.startRendering();
  return { results, capped, cleared };
}
