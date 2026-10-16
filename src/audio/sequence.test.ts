import { describe, expect, it } from 'vitest';
import { mixSceneSequence, SCENE_SEQUENCE, SEQUENCE_GAIN } from './sequence';
import type { SoundScene } from './directions';

describe('連続場面の混合', () => {
  it('余韻の抑制を切れば、同時刻のサンプルを正確に足す', () => {
    const rate = 1000;
    const samples = new Map<SoundScene, Float32Array>([
      ['drop', new Float32Array(800).fill(0.1)], ['impact', new Float32Array(100).fill(0.2)],
    ]);
    const data = mixSceneSequence(samples, rate, false);
    expect(data[399]).toBeCloseTo(0.1 * SEQUENCE_GAIN);
    expect(data[400]).toBeCloseTo(0.3 * SEQUENCE_GAIN);
    expect(data[500]).toBeCloseTo(0.1 * SEQUENCE_GAIN);
    expect(data[800]).toBe(0);
  });
  it('重要音の開始前を変えず、25ms後に古い余韻を下げる', () => {
    const samples = new Map<SoundScene, Float32Array>([['drop', new Float32Array(1000).fill(0.4)]]);
    const rate = 1000, start = SCENE_SEQUENCE[1].at * rate;
    const data = mixSceneSequence(samples, rate);
    expect(data[start - 1]).toBeCloseTo(0.4 * SEQUENCE_GAIN);
    expect(data[start]).toBeCloseTo(0.4 * SEQUENCE_GAIN);
    expect(data[start + 25]).toBeCloseTo(0.4 * SEQUENCE_GAIN * 0.25);
    expect(data[start + 12]).toBeGreaterThan(data[start + 25]);
  });
});
