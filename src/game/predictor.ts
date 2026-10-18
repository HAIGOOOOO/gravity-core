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
import type { FlightModel } from './gravity';
import { stepFree, type Mover } from './physics';

// 丸め（quantizeLaunch）で速さは最大 √2/2 ≈ 0.71 ずれるので、それを越える余裕を持たせる
const SPEED_TOLERANCE = 1;
const OUTWARD_TOLERANCE = 1;

/** 角度の格子の目の数。共有の文字列（src/share/codec.ts）は角度をこの格子の番号（u32）で持つ。 */
export const ANGLE_GRID = 4294967296;

/**
 * 射出の値を丸める。シミュレーションは受け取った射出を必ずこれで丸めてから使い、入力ログにも丸めた値を残す。
 * 角度は 2π/2^32 の格子（0 以上 2π 未満）、速度は整数（px/秒）。
 * こうすると、共有の文字列は 1 投を数バイトで、誤差 0 で持てる。手触りへの影響は無い（速さ 200〜620 に対して 0.5 以下）。
 * 角度の式は createRng の値から角度を作る式（rng() * π * 2）と同じ計算順にしてある。
 */
export function quantizeLaunch(command: LaunchCommand): LaunchCommand {
  const { originAngleRadians: a, vx, vy } = command;
  if (![a, vx, vy].every(Number.isFinite)) return command; // 弾くのは launchRejectReason の仕事
  let k = Math.round((a / (Math.PI * 2)) * ANGLE_GRID) % ANGLE_GRID;
  if (k < 0) k += ANGLE_GRID;
  // + 0 で -0 を 0 にそろえる（入力ログと共有の文字列で 0 の符号がずれないように）
  return { originAngleRadians: (k / ANGLE_GRID) * Math.PI * 2 + 0, vx: Math.round(vx) + 0, vy: Math.round(vy) + 0 };
}

/** 射出を受け付けられない理由。受け付けられるなら null。 */
export function launchRejectReason(snapshot: GameSnapshot, command: LaunchCommand): LaunchRejectReason | null {
  if (snapshot.phase === 'over') return 'gameOver';
  // 共有の文字列などから来た NaN・無限大は、下の比べ方を全部すり抜けるので先に断る
  if (![command.vx, command.vy, command.originAngleRadians].every(Number.isFinite)) return 'speed';
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
 *
 * @param flight 重力操作が効いているときの進め方。井戸と渦で曲がる道すじを出す。
 *   山が動いている（uncertain）ときも道すじは全長出す（撃った天体の動きは計算できる）。当たり先だけ答えない。
 */
export function predictLaunch(snapshot: GameSnapshot, command: LaunchCommand, flight?: FlightModel): Prediction {
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
  const uncertain = flight?.uncertain === true;
  const ticks = Math.round(PREDICT_SECONDS / DT);
  const sampleEvery = Math.max(1, Math.round(PREDICT_SAMPLE_SECONDS / DT));
  const points: PathPoint[] = [{ x: shot.x, y: shot.y, t: 0 }];
  let end: Prediction['end'] = 'timeLimit';
  let hitBodyId: number | null = null;
  let willMerge = false;

  for (let i = 1; i <= ticks && end === 'timeLimit'; i++) {
    if (flight) flight.step(shot);
    else stepFree(shot);
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

  const base = { valid: reason === null, ...(reason ? { rejectReason: reason } : {}), points };
  // 山が動いているときは、線と終わり方は出すが「何に当たるか」は答えない（終点は「不確か」の見た目で描く）
  if (uncertain) return { ...base, end, hitBodyId: null, willMerge: false, uncertain: true };
  return { ...base, end, hitBodyId, willMerge };
}
