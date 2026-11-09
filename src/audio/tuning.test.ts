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
  it('速い着地を強め、連鎖を積み上げても発音の上限と超新星の無音を守る', () => {
    const low = eventTones({ ...sampleEvent('land'), impactSpeed: 100 })[0];
    const high = eventTones({ ...sampleEvent('land'), impactSpeed: 600 })[0];
    expect(high.gain).toBeGreaterThan(low.gain);
    const small = eventTones(sampleEvent('merge', 2, 0, 0, 1));
    const chain = eventTones(sampleEvent('merge', 2, 0, 0, 3));
    const maximum = eventTones(sampleEvent('merge', 2, 0, 0, 5));
    expect(small.some(tone => tone.wave === 'noise')).toBe(true);
    expect(chain.length).toBeGreaterThan(small.length);
    expect(maximum.length).toBeGreaterThan(chain.length);
    expect(maximum.length).toBeLessThanOrEqual(AUDIO.maxVoices);
    const nova = eventTones(sampleEvent('supernova'));
    expect(nova.length).toBeLessThanOrEqual(AUDIO.maxVoices);
    expect(nova.every((tone) => tone.delay >= AUDIO.novaSilence)).toBe(true);
    expect(nova.some(tone => (tone.endFrequency ?? 100) < 40)).toBe(true);
  });
});
