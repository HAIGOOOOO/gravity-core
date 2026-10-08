// 重力と移動（SPEC.md 3.3）。天体どうしは引き合わない。引力を持つのは中央の核だけ。

import {
  DT,
  MERGE_SPEED_BASE,
  MERGE_SPEED_FLOOR,
  MERGE_SPEED_PER_TIER,
  MU,
  SOFTENING,
} from './constants';

export type Mover = { x: number; y: number; vx: number; vy: number };

const SOFT2 = SOFTENING * SOFTENING;

/** 1 tick 進める。速度を先に更新してから位置を進める（軌道が長時間ずれにくい）。 */
export function stepGravity(body: Mover): void {
  const d2 = body.x * body.x + body.y * body.y + SOFT2;
  const k = -MU / (d2 * Math.sqrt(d2));
  body.vx += k * body.x * DT;
  body.vy += k * body.y * DT;
  body.x += body.vx * DT;
  body.y += body.vy * DT;
}

/** 半径 r の円軌道の速さ。 */
export function circularSpeed(r: number): number {
  const d2 = r * r + SOFT2;
  return Math.sqrt((MU * r * r) / (d2 * Math.sqrt(d2)));
}

/** 時計回り（画面上）の接線の単位ベクトル。 */
export function clockwiseTangent(angle: number): { x: number; y: number } {
  return { x: -Math.sin(angle), y: Math.cos(angle) };
}

/** その Tier どうしが融合できる相対速度の上限。 */
export function mergeSpeedLimit(tier: number): number {
  return Math.max(MERGE_SPEED_FLOOR, MERGE_SPEED_BASE - MERGE_SPEED_PER_TIER * tier);
}
