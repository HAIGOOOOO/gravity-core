import type { Tone } from './tones';
import { AUDIO } from './tuning';

type Voice = { oscillator: OscillatorNode; envelope: GainNode };

export function createVoices(context: BaseAudioContext) {
  const master = context.createGain();
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 18;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.15;
  master.gain.value = 0;
  master.connect(compressor);
  compressor.connect(context.destination);
  const active = new Set<Voice>();

  function release(voice: Voice): void {
    if (!active.delete(voice)) return;
    voice.oscillator.disconnect();
    voice.envelope.disconnect();
  }

  return {
    get count(): number { return active.size; },
    setVolume(volume: number): void {
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(volume, context.currentTime, AUDIO.smoothing);
    },
    play(tones: readonly Tone[]): number {
      let played = 0;
      for (const tone of tones) {
        if (active.size >= AUDIO.maxVoices) break;
        const start = context.currentTime + tone.delay;
        const end = start + tone.seconds;
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        oscillator.type = tone.wave;
        oscillator.frequency.setValueAtTime(tone.frequency, start);
        if (tone.endFrequency !== undefined) oscillator.frequency.exponentialRampToValueAtTime(tone.endFrequency, end);
        envelope.gain.setValueAtTime(0, start);
        envelope.gain.linearRampToValueAtTime(tone.gain, start + AUDIO.attack);
        envelope.gain.exponentialRampToValueAtTime(AUDIO.floor, end);
        oscillator.connect(envelope);
        envelope.connect(master);
        const voice = { oscillator, envelope };
        active.add(voice);
        oscillator.onended = () => release(voice);
        oscillator.start(start);
        oscillator.stop(end);
        played++;
      }
      return played;
    },
    stop(): void {
      for (const voice of active) {
        // 予約した音も切り離し、再開や音の設定変更の後に古い音を出さない。
        try { voice.oscillator.stop(context.currentTime); } catch { /* 既に終了した音 */ }
        release(voice);
      }
    },
  };
}
