import type { AudioManager } from '../contracts/app';
import { eventTones } from './tones';
import { AUDIO, createRateGate, masterVolume } from './tuning';
import { createVoices } from './voices';

const diagnostics = new WeakMap<AudioManager, () => { state: string; voices: number; volume: number; sfx: boolean }>();

export function inspectAudio(manager: AudioManager) {
  return diagnostics.get(manager)?.() ?? { state: 'locked', voices: 0, volume: 0, sfx: false };
}

export function createAudioManager(): AudioManager {
  let context: AudioContext | null = null;
  let voices: ReturnType<typeof createVoices> | null = null;
  let sfx = true;
  let volume = 70;
  let suspended = false;
  let silenceUntil = 0;
  const land = createRateGate(AUDIO.landCount, AUDIO.landWindow);

  function available(): boolean {
    return !!context && !!voices && !suspended && sfx && masterVolume(volume) > 0
      && context.state === 'running';
  }

  const manager: AudioManager = {
    unlock() {
      if (!context) {
        if (typeof globalThis.AudioContext !== 'function') return;
        try {
          context = new AudioContext();
          voices = createVoices(context);
          voices.setVolume(sfx ? masterVolume(volume) : 0);
        } catch { context = null; voices = null; return; }
      }
      if (!suspended) void context.resume().catch(() => {});
    },
    setSettings(settings) {
      sfx = settings.sfx;
      volume = settings.volume;
      voices?.setVolume(sfx ? masterVolume(volume) : 0);
      if (!sfx || masterVolume(volume) === 0) voices?.stop();
    },
    handleEvents(events, snapshot) {
      void snapshot;
      if (!available() || !context || !voices) return;
      for (const event of events) {
        if (context.currentTime < silenceUntil && event.kind !== 'supernova') continue;
        if (event.kind === 'land' && !land.accept(context.currentTime)) continue;
        if (event.kind === 'supernova') {
          voices.stop();
          silenceUntil = context.currentTime + AUDIO.novaSilence;
        }
        voices.play(eventTones(event));
      }
    },
    // 臨界・終了・画面の音は手順 5 で追加する。
    setCritical() {},
    play() {},
    suspend() {
      suspended = true;
      voices?.stop();
      land.reset();
      if (context) void context.suspend().catch(() => {});
    },
    resume() {
      suspended = false;
      if (context) void context.resume().catch(() => {});
    },
  };
  diagnostics.set(manager, () => ({ state: context?.state ?? 'locked', voices: voices?.count ?? 0, volume: sfx ? masterVolume(volume) : 0, sfx }));
  return manager;
}
