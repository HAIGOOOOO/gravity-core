// 予測。いまの盤面が止まっていると仮定して、撃った天体が最初に何かへ触れるまでを計算する。
// 盤面は変更しない。

import type { GameSnapshot, LaunchCommand, LaunchRejectReason, PathPoint, Prediction } from '../contracts/game';
import {
  CORE_RADIUS,
  DT,
  LAUNCH_OVERLAP_MARGIN,
  LAUNCH_RADIUS,
  PREDICT_SAMPLE_SECONDS,
  PREDICT_SECONDS,
  SPEED_MAX,
  SPEED_MIN,
  TIER_RADIUS,
} from './constants';
import { stepFree, type Mover } from './physics';

const SPEED_TOLERANCE = 0.5;
const OUTWARD_TOLERANCE = 1;

/** 射出を受け付けられない理由。受け付けられるなら null。 */
export function launchRejectReason(snapshot: GameSnapshot, command: LaunchCommand): LaunchRejectReason | null {
  if (snapshot.phase === 'over') return 'gameOver';
  const speed = Math.hypot(command.vx, command.vy);
  if (speed < SPEED_MIN - SPEED_TOLERANCE || speed > SPEED_MAX + SPEED_TOLERANCE) return 'speed';
  const cos = Math.cos(command.originAngleRadians);
  const sin = Math.sin(command.originAngleRadians);
  // 外へ向かって撃つことはできない
  if (command.vx * cos + command.vy * sin > OUTWARD_TOLERANCE) return 'speed';
  const radius = TIER_RADIUS[snapshot.nextQueue[0]];
  const ox = LAUNCH_RADIUS * cos;
  const oy = LAUNCH_RADIUS * sin;
  for (const b of snapshot.bodies) {
    if (Math.hypot(b.x - ox, b.y - oy) < b.radius + radius + LAUNCH_OVERLAP_MARGIN) return 'overlap';
  }
  if (snapshot.launchCooldownLeftSeconds > 0) return 'cooldown';
  return null;
}

/**
 * 今の盤面でこの射出をした場合の予測を返す。
 * 待ち時間中（cooldown）でも線は返す。照準は待ち時間中に始められるため。
 */
export function predictLaunch(snapshot: GameSnapshot, command: LaunchCommand): Prediction {
  const reason = launchRejectReason(snapshot, command);
  if (reason !== null && reason !== 'cooldown') {
    return { valid: false, rejectReason: reason, points: [], end: 'timeLimit', hitBodyId: null, willMerge: false };
  }

  const tier = snapshot.nextQueue[0];
  const radius = TIER_RADIUS[tier];
  const shot: Mover = {
    x: LAUNCH_RADIUS * Math.cos(command.originAngleRadians),
    y: LAUNCH_RADIUS * Math.sin(command.originAngleRadians),
    vx: command.vx,
    vy: command.vy,
  };
  const ticks = Math.round(PREDICT_SECONDS / DT);
  const sampleEvery = Math.max(1, Math.round(PREDICT_SAMPLE_SECONDS / DT));
  const points: PathPoint[] = [{ x: shot.x, y: shot.y, t: 0 }];
  let end: Prediction['end'] = 'timeLimit';
  let hitBodyId: number | null = null;
  let willMerge = false;

  for (let i = 1; i <= ticks && end === 'timeLimit'; i++) {
    stepFree(shot);
    for (const b of snapshot.bodies) {
      const reach = b.radius + radius;
      const dx = b.x - shot.x;
      const dy = b.y - shot.y;
      if (dx * dx + dy * dy <= reach * reach) {
        end = 'body';
        hitBodyId = b.id;
        willMerge = b.tier === tier;
        break;
      }
    }
    if (end === 'timeLimit' && Math.hypot(shot.x, shot.y) <= CORE_RADIUS + radius) end = 'core';
    if (i % sampleEvery === 0 || end !== 'timeLimit') points.push({ x: shot.x, y: shot.y, t: i * DT });
  }

  return { valid: reason === null, ...(reason ? { rejectReason: reason } : {}), points, end, hitBodyId, willMerge };
}
