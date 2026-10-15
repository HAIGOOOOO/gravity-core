export type SoundMetrics = {
  peak: number; rms: number; clipped: number; attackMs: number; audibleMs: number;
  bands: readonly [number, number, number];
};
export const FFT_SIZE = 2048;
export const FFT_HOP = 512;

/** Hann窓付きFFT。比較用の全画像で同じ窓・振幅基準を使う。 */
export function spectrum(data: Float32Array, offset = 0, size = FFT_SIZE): Float64Array {
  if (size < 2 || (size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two');
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  for (let i = 0; i < size; i++) real[i] = (data[offset + i] ?? 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [real[i], real[j]] = [real[j], real[i]];
  }
  for (let width = 2; width <= size; width *= 2) {
    const half = width / 2;
    for (let start = 0; start < size; start += width) {
      for (let k = 0; k < half; k++) {
        const angle = -2 * Math.PI * k / width;
        const a = start + k, b = a + half;
        const r = real[b] * Math.cos(angle) - imag[b] * Math.sin(angle);
        const im = real[b] * Math.sin(angle) + imag[b] * Math.cos(angle);
        real[b] = real[a] - r; imag[b] = imag[a] - im;
        real[a] += r; imag[a] += im;
      }
    }
  }
  return Float64Array.from({ length: size / 2 + 1 }, (_, i) => Math.hypot(real[i], imag[i]) * 4 / size);
}

export function spectrogram(data: Float32Array): Float64Array[] {
  const frames: Float64Array[] = [];
  for (let center = 0; center < data.length; center += FFT_HOP) frames.push(spectrum(data, center - FFT_SIZE / 2));
  return frames;
}

/** 同じ場面のRMSを揃えつつ、補正後ピークにも余裕を残す。知覚音量の一致ではない。 */
export function comparisonGains(metrics: readonly Pick<SoundMetrics, 'rms' | 'peak'>[]): number[] {
  const sounding = metrics.filter(m => m.rms > 0 && m.peak > 0);
  if (!sounding.length) return metrics.map(() => 0);
  const target = Math.min(Math.max(...sounding.map(m => m.rms)), ...sounding.map(m => 0.8 * m.rms / m.peak));
  return metrics.map(m => m.rms > 0 ? target / m.rms : 0);
}

export function measureSound(data: Float32Array, rate: number, frames = spectrogram(data)): SoundMetrics {
  let peak = 0, energy = 0, clipped = 0, last = 0;
  for (const sample of data) {
    peak = Math.max(peak, Math.abs(sample)); energy += sample * sample;
    if (Math.abs(sample) >= 1) clipped++;
  }
  let ninety = -1;
  for (let i = 0; i < data.length; i++) {
    if (peak > 0 && ninety < 0 && Math.abs(data[i]) >= peak * 0.9) ninety = i;
    if (Math.abs(data[i]) >= 0.001) last = i;
  }
  const bands: [number, number, number] = [0, 0, 0];
  for (const frame of frames) for (let k = 1; k < frame.length; k++) {
    const hz = k * rate / FFT_SIZE;
    bands[hz < 250 ? 0 : hz < 2000 ? 1 : 2] += frame[k] ** 2;
  }
  const total = bands.reduce((a, b) => a + b, 0);
  return { peak, rms: Math.sqrt(energy / Math.max(1, data.length)), clipped,
    attackMs: Math.max(0, ninety) / rate * 1000, audibleMs: last / rate * 1000,
    bands: bands.map(value => total > 0 ? value / total : 0) as [number, number, number] };
}
