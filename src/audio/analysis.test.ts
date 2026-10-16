import { describe, expect, it } from 'vitest';
import { comparisonGains, measureSound, spectrum, FFT_SIZE } from './analysis';
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
  it('比較音量を揃えても最大値0.8を超えず、無音を増幅しない', () => {
    const inputs = [{ rms: 0.1, peak: 0.9 }, { rms: 0.3, peak: 0.4 }, { rms: 0, peak: 0 }];
    const gains = comparisonGains(inputs);
    expect(inputs[0].rms * gains[0]).toBeCloseTo(inputs[1].rms * gains[1]);
    inputs.forEach((m, i) => expect(m.peak * gains[i]).toBeLessThanOrEqual(0.8 + Number.EPSILON));
    expect(gains[2]).toBe(0);
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
  it.each(DIRECTIONS)('%s の大合体には小型スピーカーへ届く中域を残す', direction => {
    const metrics = measureSound(synthesizeDirection(direction, 'large'), LAB_RATE);
    expect(metrics.bands[1]).toBeGreaterThan(0.25);
  });
  it('音階案は即座に一打を置き、落下より合体に長い応答を与える', () => {
    const drop = measureSound(synthesizeDirection('musical', 'drop'), LAB_RATE);
    const small = measureSound(synthesizeDirection('musical', 'small'), LAB_RATE);
    const large = measureSound(synthesizeDirection('musical', 'large'), LAB_RATE);
    expect(small.audibleMs).toBeGreaterThan(drop.audibleMs * 2);
    expect(small.attackMs).toBeLessThan(20);
    expect(large.attackMs).toBeLessThan(20);
  });
});
