import type { Prediction } from '../contracts/game';
import { BOARD_ROTATION_RADIANS_PER_SECOND, DT } from './constants';
import { NATIVE_ANGLES, PORTABLE_ANGLES, type AngleMath } from './angle';

type MovingPoint = { x: number; y: number; vx: number; vy: number; px: number; py: number };
const ONE_TICK = BOARD_ROTATION_RADIANS_PER_SECOND * DT;
const PORTABLE_DRIFT = PORTABLE_ANGLES.vector(ONE_TICK);
const NATIVE_DRIFT = NATIVE_ANGLES.vector(ONE_TICK);

/** 射出中も山も同じ座標変換に通す。相対位置と速度の大きさを変えない。 */
export function driftBoard(bodies: readonly MovingPoint[], angles: AngleMath = PORTABLE_ANGLES): void {
  const { x: cos, y: sin } = angles === NATIVE_ANGLES ? NATIVE_DRIFT : PORTABLE_DRIFT;
  for (const b of bodies) {
    const { x, y, vx, vy } = b;
    b.x = x * cos - y * sin; b.y = x * sin + y * cos;
    b.px = b.x; b.py = b.y;
    b.vx = vx * cos - vy * sin; b.vy = vx * sin + vy * cos;
  }
}
function rotate<T extends { x: number; y: number }>(point: T, seconds: number, angles: AngleMath): T {
  const { x: c, y: s } = angles.vector(BOARD_ROTATION_RADIANS_PER_SECOND * seconds);
  return { ...point, x: point.x * c - point.y * s, y: point.x * s + point.y * c };
}
/** 相対配置を固定した座標系で予測し、各時刻の実際の表示位置へ戻す。 */
export function driftPrediction(prediction: Prediction, angles: AngleMath = PORTABLE_ANGLES): Prediction {
  const preview = prediction.mergePreview, seconds = prediction.points.at(-1)?.t ?? 0;
  return { ...prediction, points: prediction.points.map((p) => rotate(p, p.t, angles)),
    ...(preview ? { mergePreview: { ...rotate(preview, seconds, angles), pushed: preview.pushed.map((b) => rotate(b, seconds, angles)) } } : {}) };
}
