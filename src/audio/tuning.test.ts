import { describe, expect, it } from 'vitest';
import { AUDIO, chainFrequency, createRateGate, masterVolume, mergeDuration, mergeFrequency } from './tuning';
import { eventTones } from './tones';
import { sampleEvent } from '../fixtures';

describe('音の高さ・長さと上限', () => {
  it('音量は 0〜100 を 0〜0.8 にし、不正な値を鳴らさない', () => {
    expect(masterVolume(100)).toBe(0.8);
    expect(masterVolume(50)).toBe(0.4);
    expect(masterVolume(-20)).toBe(0);
    expect(masterVolume(NaN)).toBe(0);
    expect(masterVolume(200)).toBe(0.8);
  });
  it('Tier が高いほど低く、長い合体音にする', () => {
    expect(mergeFrequency(0)).toBe(523);
    expect(mergeFrequency(6)).toBe(261.5);
    expect(mergeDuration(8)).toBeGreaterThan(mergeDuration(0));
  });
  it('連鎖は 1 オクターブ上から、連鎖 1 ごとに全音上げる', () => {
    expect(chainFrequency(0, 1)).toBe(1046);
    expect(chainFrequency(0, 3) / chainFrequency(0, 2)).toBeCloseTo(2 ** (2 / 12));
  });
  it('着地を区切った時間枠でなく、直近 0.25 秒に 4 回までにする', () => {
    const gate = createRateGate(AUDIO.landCount, AUDIO.landWindow);
    for (let i = 0; i < 4; i++) expect(gate.accept(0)).toBe(true);
    expect(gate.accept(0.249)).toBe(false);
    expect(gate.accept(0.25)).toBe(true);
    for (let i = 0; i < 3; i++) expect(gate.accept(0.25)).toBe(true);
    expect(gate.accept(0.251)).toBe(false);
    gate.reset();
    expect(gate.accept(0.251)).toBe(true);
  });
  it('速い着地を強め、合体・超新星の発振器数と無音の間を守る', () => {
    const low = eventTones({ ...sampleEvent('land'), impactSpeed: 100 })[0];
    const high = eventTones({ ...sampleEvent('land'), impactSpeed: 600 })[0];
    expect(high.gain).toBeGreaterThan(low.gain);
    expect(eventTones(sampleEvent('merge', 2, 0, 0, 1))).toHaveLength(2);
    expect(eventTones(sampleEvent('merge', 2, 0, 0, 3))).toHaveLength(3);
    const nova = eventTones(sampleEvent('supernova'));
    expect(nova).toHaveLength(4);
    expect(nova.every((tone) => tone.delay === 0.15 && tone.seconds === 1.2)).toBe(true);
  });
});
