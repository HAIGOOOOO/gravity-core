// 予測（SPEC.md 3.8）。核の重力だけで計算し、天体どうしの衝突は含めない。盤面は変更しない。

import type {
  Fate,
  GameSnapshot,
  LaunchCommand,
  LaunchRejectReason,
  PathPoint,
  Prediction,
  RivalPrediction,
} from '../contracts/game';
import {
  CORE_RADIUS,
  DT,
  LAUNCH_OVERLAP_MARGIN,
  LAUNCH_RADIUS,
  MEET_DISTANCE_FACTOR,
  OUT_RADIUS,
  OUT_SECONDS,
  PREDICT_FATE_SECONDS,
  PREDICT_MARKER_SECONDS,
  PREDICT_SAMPLE_SECONDS,
  PREDICT_SECONDS,
  SPEED_MAX,
  SPEED_MIN,
  TIER_RADIUS,
} from './constants';
import { mergeSpeedLimit, stepGravity, type Mover } from './physics';

const SPEED_TOLERANCE = 0.5;

/** 射出を受け付けられない理由。受け付けられるなら null。 */
export function launchRejectReason(
  snapshot: GameSnapshot,
  command: LaunchCommand,
): LaunchRejectReason | null {
  if (snapshot.phase === 'over') return 'gameOver';
  const speed = Math.hypot(command.vx, command.vy);
  if (speed < SPEED_MIN - SPEED_TOLERANCE || speed > SPEED_MAX + SPEED_TOLERANCE) return 'speed';
  const radius = TIER_RADIUS[snapshot.nextQueue[0]];
  const ox = LAUNCH_RADIUS * Math.cos(command.originAngleRadians);
  const oy = LAUNCH_RADIUS * Math.sin(command.originAngleRadians);
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
    return { valid: false, rejectReason: reason, points: [], end: 'timeLimit', fate: 'orbit', markers: [], rivals: [] };
  }

  const tier = snapshot.nextQueue[0];
  const radius = TIER_RADIUS[tier];
  const shot: Mover = {
    x: LAUNCH_RADIUS * Math.cos(command.originAngleRadians),
    y: LAUNCH_RADIUS * Math.sin(command.originAngleRadians),
    vx: command.vx,
    vy: command.vy,
  };
  const rivals = snapshot.bodies
    .filter((b) => b.tier === tier)
    .map((b) => ({
      id: b.id,
      radius: b.radius,
      m: { x: b.x, y: b.y, vx: b.vx, vy: b.vy } as Mover,
      markers: [] as PathPoint[],
      meetAt: null as number | null,
      meetX: 0,
      meetY: 0,
      canMerge: false,
    }));

  const lineTicks = Math.round(PREDICT_SECONDS / DT);
  const fateTicks = Math.round(PREDICT_FATE_SECONDS / DT);
  const sampleEvery = Math.round(PREDICT_SAMPLE_SECONDS / DT);
  const markerEvery = Math.round(PREDICT_MARKER_SECONDS / DT);
  const speedLimit = mergeSpeedLimit(tier);

  const points: PathPoint[] = [{ x: shot.x, y: shot.y, t: 0 }];
  const markers: PathPoint[] = [];
  let end: Prediction['end'] = 'timeLimit';
  let fate: Fate = 'orbit';
  let outSeconds = 0;

  for (let i = 1; i <= fateTicks; i++) {
    stepGravity(shot);
    const t = i * DT;
    const inLine = i <= lineTicks && end === 'timeLimit';
    const r = Math.hypot(shot.x, shot.y);

    let stopped: Fate | null = null;
    if (r <= CORE_RADIUS + radius) {
      stopped = 'core';
    } else if (r > OUT_RADIUS) {
      outSeconds += DT;
      if (outSeconds >= OUT_SECONDS) stopped = 'outside';
    } else {
      outSeconds = 0;
    }

    if (inLine) {
      for (const rv of rivals) stepGravity(rv.m);
      if (i % sampleEvery === 0 || stopped !== null) points.push({ x: shot.x, y: shot.y, t });
      // 出会いは毎 tick 調べる（0.5 秒おきのマーカーだけでは、すれ違いを見落とすため）
      for (const rv of rivals) {
        if (rv.meetAt !== null) continue;
        const dist = Math.hypot(rv.m.x - shot.x, rv.m.y - shot.y);
        if (dist <= (rv.radius + radius) * MEET_DISTANCE_FACTOR) {
          rv.meetAt = t;
          rv.meetX = (rv.m.x + shot.x) / 2;
          rv.meetY = (rv.m.y + shot.y) / 2;
          rv.canMerge = Math.hypot(rv.m.vx - shot.vx, rv.m.vy - shot.vy) <= speedLimit;
        }
      }
      if (i % markerEvery === 0 && stopped === null) {
        markers.push({ x: shot.x, y: shot.y, t });
        for (const rv of rivals) rv.markers.push({ x: rv.m.x, y: rv.m.y, t });
      }
    }

    if (stopped !== null) {
      fate = stopped;
      if (i <= lineTicks) end = stopped;
      break;
    }
  }

  const rivalOut: RivalPrediction[] = rivals.map((rv) => ({
    bodyId: rv.id,
    markers: rv.markers,
    meetAt: rv.meetAt,
    meetX: rv.meetX,
    meetY: rv.meetY,
    canMerge: rv.canMerge,
  }));
  return { valid: reason === null, ...(reason ? { rejectReason: reason } : {}), points, end, fate, markers, rivals: rivalOut };
}
