const QUARTER_TURN = Math.PI / 2;
const FULL_TURN = 2 * Math.PI;

// 角度を±π/4に縮めた後で使うテイラー級数。係数は高次から並べる。
const SINE = [1 / 355687428096000, -1 / 1307674368000, 1 / 6227020800, -1 / 39916800,
  1 / 362880, -1 / 5040, 1 / 120, -1 / 6, 1];
const COSINE = [1 / 20922789888000, -1 / 87178291200, 1 / 479001600, -1 / 3628800,
  1 / 40320, -1 / 720, 1 / 24, -1 / 2, 1];

function polynomial(coefficients: readonly number[], x: number): number {
  let sum = 0;
  for (const coefficient of coefficients) sum = sum * x + coefficient;
  return sum;
}

/** 実行環境のsin/cos実装に頼らず、盤面で使う角度を単位ベクトルへ変換する。 */
export function angleVector(angle: number): { x: number; y: number } {
  const radians = angle % FULL_TURN;
  const quarter = Math.round(radians / QUARTER_TURN);
  const offset = radians - quarter * QUARTER_TURN;
  const squared = offset * offset;
  const x = polynomial(COSINE, squared), y = offset * polynomial(SINE, squared);
  switch ((quarter % 4 + 4) % 4) {
    case 0: return { x, y };
    case 1: return { x: -y, y: x };
    case 2: return { x: -x, y: -y };
    default: return { x: y, y: -x };
  }
}

/** 二つの方角を結ぶ円周のうち短い方の角度。 */
export function angleDistance(a: number, b: number): number {
  const distance = Math.abs(a - b) % FULL_TURN;
  return Math.min(distance, FULL_TURN - distance);
}

export type AngleMath = Readonly<{ vector: typeof angleVector; distance: typeof angleDistance }>;
export const PORTABLE_ANGLES: AngleMath = { vector: angleVector, distance: angleDistance };
/** 形式12の再生は当時の計算で試す。実行環境が変わると旧版の差が残りうる。 */
export const NATIVE_ANGLES: AngleMath = {
  vector: angle => ({ x: Math.cos(angle), y: Math.sin(angle) }),
  distance: (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))),
};
