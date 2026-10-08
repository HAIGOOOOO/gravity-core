// 反発の計算（SPEC.md 3.7）。質量は半径の 2 乗。

import { RESTITUTION, TANGENT_DAMPING } from './constants';

export type Collider = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
};

/**
 * 重なっている 2 体を反発させ、重なりを解消する。
 * 戻り値は接近速度（近づいていた場合は正の数、離れていた場合は 0）。
 */
export function resolveBounce(a: Collider, b: Collider): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1e-6;
  const nx = dx / dist;
  const ny = dy / dist;
  const ma = a.radius * a.radius;
  const mb = b.radius * b.radius;
  const total = ma + mb;

  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const vn = rvx * nx + rvy * ny;
  let closing = 0;

  if (vn < 0) {
    closing = -vn;
    const j = (-(1 + RESTITUTION) * vn) / (1 / ma + 1 / mb);
    a.vx -= (j * nx) / ma;
    a.vy -= (j * ny) / ma;
    b.vx += (j * nx) / mb;
    b.vy += (j * ny) / mb;

    // 横すべり成分を少しだけ打ち消す
    const tx = rvx - vn * nx;
    const ty = rvy - vn * ny;
    a.vx += (TANGENT_DAMPING * tx * mb) / total;
    a.vy += (TANGENT_DAMPING * ty * mb) / total;
    b.vx -= (TANGENT_DAMPING * tx * ma) / total;
    b.vy -= (TANGENT_DAMPING * ty * ma) / total;
  }

  const pen = a.radius + b.radius - dist;
  if (pen > 0) {
    a.x -= (nx * pen * mb) / total;
    a.y -= (ny * pen * mb) / total;
    b.x += (nx * pen * ma) / total;
    b.y += (ny * pen * ma) / total;
  }
  return closing;
}
