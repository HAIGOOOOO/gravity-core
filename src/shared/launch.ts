// ドラッグ距離と射出速度の変換（SPEC.md 3.4）。全担当が使ってよい。

import { DRAG_MAX_PX, DRAG_MIN_PX, SPEED_MAX, SPEED_MIN } from '../game/constants';

/** ドラッグ距離（CSS px）から射出速度を求める。DRAG_MIN_PX 未満は null。 */
export function dragToSpeed(dragPx: number): number | null {
  if (dragPx < DRAG_MIN_PX) return null;
  const clamped = Math.min(dragPx, DRAG_MAX_PX);
  return SPEED_MIN + ((SPEED_MAX - SPEED_MIN) * (clamped - DRAG_MIN_PX)) / (DRAG_MAX_PX - DRAG_MIN_PX);
}

/** 射出速度から、それに相当するドラッグ距離（CSS px）を求める。 */
export function speedToDrag(speed: number): number {
  return DRAG_MIN_PX + ((speed - SPEED_MIN) * (DRAG_MAX_PX - DRAG_MIN_PX)) / (SPEED_MAX - SPEED_MIN);
}
