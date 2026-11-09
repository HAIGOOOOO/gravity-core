import type { Prediction } from '../contracts/game';
import { BOARD_ROTATION_RADIANS_PER_SECOND, DT } from './constants';

type MovingPoint = { x: number; y: number; vx: number; vy: number; px: number; py: number };
const COS = Math.cos(BOARD_ROTATION_RADIANS_PER_SECOND * DT);
const SIN = Math.sin(BOARD_ROTATION_RADIANS_PER_SECOND * DT);

/** 射出中も山も同じ座標変換に通す。相対位置と速度の大きさを変えない。 */
export function driftBoard(bodies: readonly MovingPoint[]): void {
  for (const b of bodies) {
    const { x, y, vx, vy } = b;
    b.x = x * COS - y * SIN; b.y = x * SIN + y * COS;
    b.px = b.x; b.py = b.y;
    b.vx = vx * COS - vy * SIN; b.vy = vx * SIN + vy * COS;
  }
}
function rotate<T extends { x: number; y: number }>(point: T, seconds: number): T {
  const c = Math.cos(BOARD_ROTATION_RADIANS_PER_SECOND * seconds), s = Math.sin(BOARD_ROTATION_RADIANS_PER_SECOND * seconds);
  return { ...point, x: point.x * c - point.y * s, y: point.x * s + point.y * c };
}
/** 相対配置を固定した座標系で予測し、各時刻の実際の表示位置へ戻す。 */
export function driftPrediction(prediction: Prediction): Prediction {
  const preview = prediction.mergePreview, seconds = prediction.points.at(-1)?.t ?? 0;
  return { ...prediction, points: prediction.points.map((p) => rotate(p, p.t)),
    ...(preview ? { mergePreview: { ...rotate(preview, seconds), pushed: preview.pushed.map((b) => rotate(b, seconds)) } } : {}) };
}
