import { describe, expect, it } from 'vitest';
import { measureSound, spectrum, FFT_SIZE } from './analysis';
import { DIRECTIONS, SCENES, synthesizeDirection, LAB_RATE } from './directions';

describe('音の測定', () => {
  it('既知の正弦波の高さ・RMS・帯域を測れる', () => {
    const rate = 48000, frequency = 750;
    const data = Float32Array.from({ length: rate }, (_, i) => 0.4 * Math.sin(2 * Math.PI * frequency * i / rate));
    const fft = spectrum(data);
    const largest = fft.indexOf(Math.max(...fft));
    expect(largest * rate / FFT_SIZE).toBe(frequency);
    expect(fft[largest]).toBeCloseTo(0.4, 2);
    const m = measureSound(data, rate);
    expect(m.rms).toBeCloseTo(0.4 / Math.sqrt(2), 4);
    expect(m.bands[1]).toBeGreaterThan(0.999);
    expect(m.clipped).toBe(0);
  });
  it('無音を安全に扱い、飽和を数える', () => {
    expect(measureSound(new Float32Array(4096), 48000).bands).toEqual([0, 0, 0]);
    expect(measureSound(new Float32Array([0, 1, -1.1, 0.5]), 48000).clipped).toBe(2);
  });
  it('ゼロから90%へ届く時間と最後の可聴サンプルを測れる', () => {
    const data = new Float32Array(1000);
    for (let i = 0; i <= 100; i++) data[i] = i / 200;
    expect(measureSound(data, 1000).attackMs).toBe(91);
    expect(measureSound(data, 1000).audibleMs).toBe(100);
  });
});

describe('3方向の6場面', () => {
  it.each(DIRECTIONS)('%s の全場面に余裕と滑らかな始終がある', direction => {
    for (const scene of SCENES) {
      const data = synthesizeDirection(direction, scene);
      const metrics = measureSound(data, LAB_RATE);
      expect(metrics.peak).toBeGreaterThan(0.04);
      expect(metrics.peak).toBeLessThan(0.9);
      expect(metrics.clipped).toBe(0);
      expect(metrics.attackMs).toBeGreaterThanOrEqual(3);
      expect(data[0]).toBe(0);
      expect(data[data.length - 1]).toBe(0);
    }
  });
  it('粒の乱数は再現でき、種を変えれば音が変わる', () => {
    const a = synthesizeDirection('pressure', 'impact', 12);
    expect(a).toEqual(synthesizeDirection('pressure', 'impact', 12));
    expect(a).not.toEqual(synthesizeDirection('pressure', 'impact', 13));
  });
});
