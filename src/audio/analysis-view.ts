import { FFT_SIZE, FFT_HOP, type SoundMetrics } from './analysis';

export function paintAnalysis(canvas: HTMLCanvasElement, data: Float32Array, rate: number, frames: Float64Array[], seconds = data.length / rate, spectralGain = 1,
  markers: readonly { at: number; label: string }[] = []): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  const left = 39, right = w - 9, top = 85, bottom = h - 23;
  const width = right - left, height = bottom - top;
  ctx.fillStyle = '#101824'; ctx.fillRect(0, 0, w, h);
  ctx.font = '11px sans-serif'; ctx.fillStyle = '#c5d3df';
  ctx.fillText('波形 ±1', 4, 13);
  ctx.strokeStyle = '#355063'; ctx.beginPath(); ctx.moveTo(left, 42); ctx.lineTo(right, 42); ctx.stroke();
  ctx.strokeStyle = '#7de0cc'; ctx.beginPath();
  const pixels = ctx.createImageData(width, height);
  const bins = Array.from({ length: height }, (_, y) => Math.round(40 * (12000 / 40) ** (1 - y / height) * FFT_SIZE / rate));
  for (let x = 0; x < width; x++) {
    const from = Math.floor(x / width * seconds * rate), to = Math.min(data.length, Math.ceil((x + 1) / width * seconds * rate));
    let min = 0, max = 0;
    for (let i = from; i < to; i++) { min = Math.min(min, data[i]); max = Math.max(max, data[i]); }
    ctx.moveTo(left + x, 42 - max * 28); ctx.lineTo(left + x, 42 - min * 28);
  }
  ctx.stroke();
  ctx.fillStyle = '#c5d3df'; ctx.fillText('周波数 / 共通色尺度 −80〜0 dBFS', 4, 77);
  for (let x = 0; x < width; x++) {
    const frame = frames[Math.min(frames.length - 1, Math.round(x / width * seconds * rate / FFT_HOP))];
    if (!frame) continue;
    for (let y = 0; y < height; y++) {
      const bin = Math.min(frame.length - 1, bins[y]);
      const db = 20 * Math.log10(Math.max(0.0001, frame[bin] * spectralGain));
      const value = Math.max(0, Math.min(1, (db + 80) / 80));
      const pixel = (y * width + x) * 4;
      pixels.data[pixel] = Math.round(value * 250);
      pixels.data[pixel + 1] = Math.round(value ** 1.4 * 210);
      pixels.data[pixel + 2] = Math.round(25 + value * 90);
      pixels.data[pixel + 3] = 255;
    }
  }
  ctx.putImageData(pixels, left, top);
  for (const marker of markers) {
    if (marker.at > seconds) continue;
    const x = left + marker.at / seconds * width;
    ctx.strokeStyle = '#b5cedd80'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, bottom); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ffd999'; ctx.fillText(marker.label, x + 3, 25);
  }
  ctx.fillStyle = '#d1dee9';
  for (const hz of [100, 1000, 10000]) {
    const y = bottom - Math.log(hz / 40) / Math.log(12000 / 40) * height;
    ctx.fillText(hz >= 1000 ? `${hz / 1000}k` : `${hz}`, 4, y + 4);
  }
  ctx.fillText('0', left, h - 6); ctx.fillText(`${seconds.toFixed(1)}秒`, right - 32, h - 6);
}

export function metricsText(m: SoundMetrics): string {
  const bands = m.bands.map(v => (v * 100).toFixed(0)).join(' / ');
  return `最大 ${m.peak.toFixed(3)} · RMS ${m.rms.toFixed(3)} · 割れ ${m.clipped}\n最大90%到達 ${m.attackMs.toFixed(1)}ms · 減衰 ${m.audibleMs.toFixed(0)}ms\n低 / 中 / 高 ${bands}%`;
}
