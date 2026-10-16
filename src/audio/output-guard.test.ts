import { describe, expect, it } from 'vitest';
import { guardedSample, outputGuardCurve } from './output-guard';

describe('出力の余裕', () => {
  it('通常音量の音色・強弱・無音を変えない', () => {
    for (const value of [-0.65, -0.2, 0, 0.1, 0.65]) expect(guardedSample(value)).toBe(value);
  });
  it('上限を超える入力でも単調に、左右対称に0.85以内へ抑える', () => {
    let previous = 0;
    for (let i = 0; i <= 10000; i++) {
      const input = i / 1000, output = guardedSample(input);
      expect(output).toBeGreaterThanOrEqual(previous);
      expect(output).toBeLessThanOrEqual(0.85 + Number.EPSILON);
      expect(guardedSample(-input)).toBe(-output);
      previous = output;
    }
  });
  it('ブラウザへ渡すカーブの中心は厳密に無音で、全点が上限内', () => {
    const curve = outputGuardCurve();
    expect(curve[16384]).toBe(0);
    expect(curve.every(value => Math.abs(value) < 0.85)).toBe(true);
  });
});
