const KNEE = 0.65;
const HEADROOM = 0.2;

/** 通常域はそのまま通し、大きな重なりだけ滑らかに0.85未満へ収める。 */
export function guardedSample(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= KNEE) return value;
  return Math.sign(value) * (KNEE + HEADROOM * Math.tanh((magnitude - KNEE) / HEADROOM));
}

export function outputGuardCurve(): Float32Array<ArrayBuffer> {
  return Float32Array.from({ length: 32769 }, (_, i) => guardedSample(i / 16384 - 1));
}
