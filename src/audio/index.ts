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
  let lastCritical = -Infinity;
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
    setCritical(on) {
      if (!on) { lastCritical = -Infinity; return; }
      if (!available() || !context || !voices || context.currentTime < silenceUntil || context.currentTime - lastCritical < AUDIO.criticalInterval / 1000) return;
      lastCritical = context.currentTime;
      voices.play([{ frequency: 440, endFrequency: 330, wave: 'triangle', gain: 0.14, seconds: 0.13, delay: 0 },
        { frequency: 330, wave: 'sine', gain: 0.05, seconds: 0.09, delay: 0.15 }]);
    },
    play(sound) {
      if (!available() || !voices) return;
      voices.play(sound === 'button'
        ? [{ frequency: 880, endFrequency: 440, wave: 'sine', gain: 0.09, seconds: 0.07, delay: 0, attackSeconds: 0.003 }]
        : [523, 659, 784, 1046].map((frequency, i) => ({ frequency, wave: 'sine', gain: 0.12, seconds: 0.55, delay: i * 0.075, pan: i % 2 ? 0.4 : -0.4 })));
    },
    suspend() {
      suspended = true;
      voices?.stop();
      land.reset();
      lastCritical = -Infinity;
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
