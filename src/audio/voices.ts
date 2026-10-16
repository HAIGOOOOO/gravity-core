import type { Tone } from './tones';
import { AUDIO } from './tuning';
import { outputGuardCurve } from './output-guard';

type Voice = { oscillator: OscillatorNode; envelope: GainNode; tailGroup?: 'launch'; fading: boolean };
const TAIL_FADE_SECONDS = 0.012;
const OVERLAP_GAIN = 0.7;

export function createVoices(context: BaseAudioContext) {
  const master = context.createGain();
  const guard = context.createWaveShaper();
  guard.curve = outputGuardCurve();
  guard.oversample = 'none';
  master.gain.value = 0;
  // TODO(依頼中): SPEC 8.4の出力段を更新。起動時に初回音が弱まる圧縮器の代わりに上限だけを守る。
  master.connect(guard);
  guard.connect(context.destination);
  const active = new Set<Voice>();
  let volumeInitialized = false;
  let trimmedTails = 0;

  function release(voice: Voice): void {
    if (!active.delete(voice)) return;
    voice.oscillator.disconnect();
    voice.envelope.disconnect();
  }

  return {
    get count(): number { return active.size; },
    get trimmedTails(): number { return trimmedTails; },
    setVolume(volume: number): void {
      master.gain.cancelScheduledValues(context.currentTime);
      // 最初はまだ音が無いので直接設定し、最初の一投だけ弱くなるのを防ぐ。
      if (!volumeInitialized) master.gain.setValueAtTime(volume, context.currentTime);
      else master.gain.setTargetAtTime(volume, context.currentTime, AUDIO.smoothing);
      volumeInitialized = true;
    },
    play(tones: readonly Tone[]): number {
      // 連射では古い余韻だけを短くし、新しい一投の全成分と立上りを残す。
      const groups = new Set(tones.map(tone => tone.tailGroup).filter(Boolean));
      const crowded = new Set<Voice['tailGroup']>();
      for (const voice of active) {
        if (!voice.tailGroup || voice.fading || !groups.has(voice.tailGroup)) continue;
        crowded.add(voice.tailGroup);
        voice.envelope.gain.cancelAndHoldAtTime(context.currentTime);
        voice.envelope.gain.exponentialRampToValueAtTime(AUDIO.floor, context.currentTime + TAIL_FADE_SECONDS);
        voice.oscillator.stop(context.currentTime + TAIL_FADE_SECONDS);
        voice.fading = true;
        trimmedTails++;
      }
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
        envelope.gain.linearRampToValueAtTime(tone.gain * (crowded.has(tone.tailGroup) ? OVERLAP_GAIN : 1), start + (tone.attackSeconds ?? AUDIO.attack));
        envelope.gain.exponentialRampToValueAtTime(AUDIO.floor, end);
        oscillator.connect(envelope);
        envelope.connect(master);
        const voice: Voice = { oscillator, envelope, tailGroup: tone.tailGroup, fading: false };
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
