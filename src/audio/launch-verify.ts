import type { Tier } from '../contracts/game';
import { LAB_RATE } from './directions';
import { eventTones } from './tones';
import { AUDIO, masterVolume } from './tuning';
import { createVoices } from './voices';
import { measureSound } from './analysis';

export type LaunchSample = { label: string; buffer: AudioBuffer };

async function single(tier: Tier, sequence: number, volume: number): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(1, LAB_RATE * 0.6, LAB_RATE);
  const voices = createVoices(context);
  voices.setVolume(masterVolume(volume));
  voices.play(eventTones({ kind: 'launch', sourceTier: tier, sequence, tick: 0 }));
  return context.startRendering();
}

export async function verifyLaunch() {
  const samples: LaunchSample[] = [];
  for (const tier of [0, 4] as const) samples.push({ label: `本番の射出 Tier ${tier}`, buffer: await single(tier, 100, 100) });
  samples.push({ label: '続けて落とした時の別の響き', buffer: await single(0, 101, 100) });
  const context = new OfflineAudioContext(1, LAB_RATE * 2.4, LAB_RATE);
  const voices = createVoices(context);
  voices.setVolume(AUDIO.master);
  let maxVoices = 0, accepted = 0;
  const play = (index: number) => {
    accepted += voices.play(eventTones({ kind: 'launch', sourceTier: (index % 5) as Tier, sequence: index + 100, tick: 0 }));
    maxVoices = Math.max(maxVoices, voices.count);
  };
  play(0);
  // オフラインの時計を各イベントで止め、本番同様に終了した音の枠を再利用する。
  const scheduled = Array.from({ length: 59 }, (_, i) => context.suspend((i + 1) / 30).then(async () => {
    play(i + 1); await context.resume();
  }));
  const stress = await context.startRendering();
  await Promise.all(scheduled);
  samples.push({ label: '毎秒30回・2秒（本番と同じ同時音上限）', buffer: stress });
  const muted = await single(0, 100, 0);
  const quiet = await single(0, 100, 50);
  const reference = samples[0].buffer.getChannelData(0);
  const changed = samples[2].buffer.getChannelData(0).some((value, i) => value !== reference[i]);
  const onset = reference.findIndex(value => Math.abs(value) > 0.00001) / LAB_RATE * 1000;
  return { samples, maxVoices, accepted, changed, onsetMs: onset,
    mutedPeak: measureSound(muted.getChannelData(0), LAB_RATE).peak,
    halfVolumeRms: measureSound(quiet.getChannelData(0), LAB_RATE).rms };
}
