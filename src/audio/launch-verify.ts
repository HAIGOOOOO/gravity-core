import type { Tier } from '../contracts/game';
import { LAB_RATE } from './directions';
import { eventTones } from './tones';
import { AUDIO, masterVolume } from './tuning';
import { createVoices } from './voices';
import { measureSound } from './analysis';

export type LaunchSample = { label: string; buffer: AudioBuffer };

async function single(tier: Tier, sequence: number, volume: number, warm = true): Promise<AudioBuffer> {
  const offset = warm ? 0.1 : 0;
  const context = new OfflineAudioContext(1, Math.round(LAB_RATE * (0.6 + offset)), LAB_RATE);
  const voices = createVoices(context);
  voices.setVolume(masterVolume(volume));
  voices.play(eventTones({ kind: 'launch', sourceTier: tier, sequence, tick: 0 }).map(tone => ({ ...tone, delay: tone.delay + offset })));
  const rendered = await context.startRendering();
  const buffer = new AudioBuffer({ numberOfChannels: 1, length: LAB_RATE * 0.6, sampleRate: LAB_RATE });
  buffer.copyToChannel(rendered.getChannelData(0).subarray(Math.round(offset * LAB_RATE)), 0);
  return buffer;
}

export async function verifyLaunch() {
  const samples: LaunchSample[] = [];
  for (const tier of [0, 4] as const) samples.push({ label: `本番の射出 Tier ${tier}`, buffer: await single(tier, 100, 100) });
  samples.push({ label: '続けて落とした時の別の響き', buffer: await single(0, 101, 100) });
  const context = new OfflineAudioContext(1, LAB_RATE * 2.4, LAB_RATE);
  const voices = createVoices(context);
  voices.setVolume(AUDIO.master);
  let maxVoices = 0, accepted = 0, silentEvents = 0, partialEvents = 0;
  const play = (index: number) => {
    const count = voices.play(eventTones({ kind: 'launch', sourceTier: (index % 5) as Tier, sequence: index + 100, tick: 0 }));
    accepted += count;
    if (count === 0) silentEvents++;
    else if (count < 3) partialEvents++;
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
  const cold = await single(0, 100, 100, false);
  samples.push({ label: '音を有効にした直後の一投', buffer: cold });
  const muted = await single(0, 100, 0);
  const quiet = await single(0, 100, 50);
  const reference = samples[0].buffer.getChannelData(0);
  let differenceEnergy = 0, referenceEnergy = 0;
  samples[2].buffer.getChannelData(0).forEach((value, i) => {
    differenceEnergy += (value - reference[i]) ** 2;
    referenceEnergy += reference[i] ** 2;
  });
  const changed = differenceEnergy > 0;
  const onset = reference.findIndex(value => Math.abs(value) > 0.00001) / LAB_RATE * 1000;
  return { samples, maxVoices, accepted, silentEvents, partialEvents, trimmedTails: voices.trimmedTails, changed, onsetMs: onset,
    relativeDifference: Math.sqrt(differenceEnergy / referenceEnergy),
    coldPeak: measureSound(cold.getChannelData(0), LAB_RATE).peak,
    fullPeak: measureSound(reference, LAB_RATE).peak,
    fullVolumeRms: measureSound(reference, LAB_RATE).rms,
    mutedPeak: measureSound(muted.getChannelData(0), LAB_RATE).peak,
    halfVolumeRms: measureSound(quiet.getChannelData(0), LAB_RATE).rms };
}
