import type { Tone } from './tones';
import { AUDIO } from './tuning';
import { outputGuardCurve } from './output-guard';

type Voice = { oscillator: AudioScheduledSourceNode; frequency: AudioParam; envelope: GainNode; filter?: BiquadFilterNode;
  panner: StereoPannerNode; noise: boolean; order: number; beginsAt: number; tailGroup?: 'launch'; fading: boolean };
const TAIL_FADE_SECONDS = 0.012;
const OVERLAP_GAIN = 0.7;

export function createVoices(context: BaseAudioContext) {
  const master = context.createGain();
  const guard = context.createWaveShaper();
  guard.curve = outputGuardCurve();
  guard.oversample = 'none';
  master.gain.value = 0;
  master.connect(guard);
  guard.connect(context.destination);
  const active = new Set<Voice>();
  // ノイズの素材は一度だけ作り、衝撃ごとの発音ではフィルターを動かす。
  const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = noise.getChannelData(0); let seed = 918273;
  for (let i = 0; i < data.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; data[i] = (seed >>> 0) / 2147483648 - 1; }
  let order = 0, stolen = 0;
  let volumeInitialized = false;
  let trimmedTails = 0;

  function release(voice: Voice): void {
    if (!active.delete(voice)) return;
    voice.oscillator.disconnect();
    voice.envelope.disconnect();
    voice.filter?.disconnect(); voice.panner.disconnect();
  }

  return {
    get count(): number { return active.size; },
    get trimmedTails(): number { return trimmedTails; },
    get stolenVoices(): number { return stolen; },
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
        const isNoise = tone.wave === 'noise';
        let voice = active.size >= AUDIO.maxVoices
          ? [...active].filter(v => v.noise === isNoise).sort((a, b) => a.order - b.order)[0] : undefined;
        if (active.size >= AUDIO.maxVoices && !voice) continue;
        const reused = !!voice;
        const start = Math.max(context.currentTime + tone.delay + (reused ? TAIL_FADE_SECONDS : 0), voice?.beginsAt ?? 0);
        const end = start + tone.seconds;
        if (!voice) {
          const envelope = context.createGain(), panner = context.createStereoPanner();
          if (isNoise) {
            const oscillator = context.createBufferSource(), filter = context.createBiquadFilter();
            oscillator.buffer = noise; oscillator.loop = true; filter.type = 'bandpass'; filter.Q.value = 0.65;
            oscillator.connect(filter); filter.connect(envelope);
            voice = { oscillator, filter, frequency: filter.frequency, envelope, panner, noise: true, order: order++, beginsAt: start, fading: false };
          } else {
            const oscillator = context.createOscillator(); oscillator.connect(envelope);
            voice = { oscillator, frequency: oscillator.frequency, envelope, panner, noise: false, order: order++, beginsAt: start, fading: false };
          }
          envelope.connect(panner); panner.connect(master); active.add(voice);
          const created = voice; voice.oscillator.onended = () => release(created);
        } else {
          // 枠が埋まった時は古い発音器を12msで静めて再利用し、新しい衝撃を欠かさない。
          voice.envelope.gain.cancelAndHoldAtTime(context.currentTime);
          voice.envelope.gain.linearRampToValueAtTime(0, context.currentTime + TAIL_FADE_SECONDS);
          voice.order = order++; stolen++;
        }
        const { oscillator, envelope, frequency, panner } = voice;
        if (!isNoise) (oscillator as OscillatorNode).type = tone.wave as OscillatorType;
        frequency.cancelScheduledValues(start); frequency.setValueAtTime(tone.frequency, start);
        if (tone.endFrequency !== undefined) frequency.exponentialRampToValueAtTime(tone.endFrequency, end);
        panner.pan.cancelScheduledValues(context.currentTime); panner.pan.setValueAtTime(tone.pan ?? 0, start);
        envelope.gain.setValueAtTime(0, start);
        envelope.gain.linearRampToValueAtTime(tone.gain * (crowded.has(tone.tailGroup) ? OVERLAP_GAIN : 1), start + (tone.attackSeconds ?? AUDIO.attack));
        envelope.gain.exponentialRampToValueAtTime(AUDIO.floor, end);
        voice.tailGroup = tone.tailGroup; voice.fading = false;
        if (!reused) oscillator.start(start);
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
