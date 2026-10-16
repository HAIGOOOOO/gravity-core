import { describe, expect, it } from 'vitest';
import { launchTones } from './launch';
import { eventTones } from './tones';
import { soundVariation } from './variation';

describe('本番の射出音', () => {
  it('打撃とは違う下降を全成分に持ち、待ち時間を足さない', () => {
    for (const tone of launchTones(0, 1)) {
      expect(tone.endFrequency).toBeLessThan(tone.frequency);
      expect(tone.delay).toBe(0);
      expect(tone.attackSeconds).toBeGreaterThanOrEqual(0.003);
      expect(tone.attackSeconds).toBeLessThan(0.02);
    }
  });
  it('大きい天体は低く長く、連投は高さ・長さ・音量をわずかに変える', () => {
    const a = launchTones(0, 100), b = launchTones(0, 101), heavy = launchTones(8, 100);
    expect(a).toEqual(launchTones(0, 100));
    expect(a[0].frequency).not.toBe(b[0].frequency);
    expect(a[0].seconds).not.toBe(b[0].seconds);
    expect(a[0].gain).not.toBe(b[0].gain);
    expect(heavy[0].frequency).toBeLessThan(a[0].frequency);
    expect(heavy[0].seconds).toBeGreaterThan(a[0].seconds);
  });
  it('ゲームイベントから同じ射出音へ接続する', () => {
    expect(eventTones({ kind: 'launch', sourceTier: 4, sequence: 123, tick: 0 })).toEqual(launchTones(4, 123));
  });
  it('連続番号の微差が十分に散らばり、音高の変化を2%以内に保つ', () => {
    const values = Array.from({ length: 128 }, (_, sequence) => soundVariation(sequence));
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.9);
    expect(values.every(value => value >= 0 && value < 1)).toBe(true);
    const frequencies = Array.from({ length: 128 }, (_, sequence) => launchTones(0, sequence)[0].frequency);
    expect(Math.min(...frequencies)).toBeGreaterThanOrEqual(720 * 0.98);
    expect(Math.max(...frequencies)).toBeLessThanOrEqual(720 * 1.02);
    expect(Math.abs(1200 * Math.log2(frequencies[101] / frequencies[100]))).toBeGreaterThan(1);
  });
});
