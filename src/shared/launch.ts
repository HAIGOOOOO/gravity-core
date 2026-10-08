// 押した位置とドラッグから、射出の速度を決める。全担当が使ってよい。
//
// ・ドラッグが短い（DRAG_MIN_PX 未満）: 核へまっすぐ落とす
// ・それ以上: ドラッグした向きへ投げる。長く引くほど速い。外向きには投げられない

import { DRAG_MAX_PX, DRAG_MIN_PX, DROP_SPEED, SPEED_MAX, SPEED_MIN } from '../game/constants';

export type AimVelocity = {
  vx: number;
  vy: number;
  speed: number;
  /** まっすぐ落とす（ドラッグが短い） */
  straight: boolean;
};

/**
 * @param originAngle 射出点の角度（ラジアン）
 * @param dragX ドラッグの移動量（CSS px。画面の右が +）
 * @param dragY ドラッグの移動量（CSS px。画面の下が +）
 */
export function aimVelocity(originAngle: number, dragX: number, dragY: number): AimVelocity {
  const outX = Math.cos(originAngle);
  const outY = Math.sin(originAngle);
  const dragPx = Math.hypot(dragX, dragY);
  if (dragPx < DRAG_MIN_PX) {
    return { vx: -outX * DROP_SPEED, vy: -outY * DROP_SPEED, speed: DROP_SPEED, straight: true };
  }
  const t = (Math.min(dragPx, DRAG_MAX_PX) - DRAG_MIN_PX) / (DRAG_MAX_PX - DRAG_MIN_PX);
  const speed = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * t;
  let dx = dragX / dragPx;
  let dy = dragY / dragPx;
  // 外向きの成分は取り除く（輪に沿う向きまでしか投げられない）
  const outward = dx * outX + dy * outY;
  if (outward > 0) {
    dx -= outward * outX;
    dy -= outward * outY;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      dx = -outX;
      dy = -outY;
    } else {
      dx /= len;
      dy /= len;
    }
  }
  return { vx: dx * speed, vy: dy * speed, speed, straight: false };
}
