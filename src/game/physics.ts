// 重力と動き。引力を持つのは中央の核だけで、強さは距離によらず一定。

import { AIR_DAMPING, DT, GRAVITY } from './constants';

export type Mover = { x: number; y: number; vx: number; vy: number };

/** 重力と空気の減速を速度に反映する（位置はまだ動かさない）。 */
export function applyGravity(body: Mover): void {
  const r = Math.hypot(body.x, body.y);
  if (r > 1e-6) {
    body.vx -= (GRAVITY * body.x * DT) / r;
    body.vy -= (GRAVITY * body.y * DT) / r;
  }
  const keep = 1 - AIR_DAMPING * DT;
  body.vx *= keep;
  body.vy *= keep;
}

/** 何にも触れずに 1 tick 進める（予測用）。 */
export function stepFree(body: Mover): void {
  applyGravity(body);
  body.x += body.vx * DT;
  body.y += body.vy * DT;
}

/** 時計回り（画面上）の接線の単位ベクトル。 */
export function clockwiseTangent(angle: number): { x: number; y: number } {
  return { x: -Math.sin(angle), y: Math.cos(angle) };
}
