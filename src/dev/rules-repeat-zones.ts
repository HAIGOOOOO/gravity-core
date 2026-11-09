import type { GameSnapshot } from '../contracts/game';
import { BOARD_ROTATION_RADIANS_PER_SECOND, REPEAT_LAUNCH_ANGLE, TICK_HZ } from '../game/constants';
import { launchHeating } from '../game/launch-heat';

const TAU = Math.PI * 2;
const wrap = (angle: number) => (angle % TAU + TAU) % TAU;

/** 判定の変わる境目だけで分割し、本体と同じ加熱計算で危険な方角を示す。 */
export function repeatHeatingZones(snapshot: GameSnapshot): { start: number; end: number }[] {
  const recent = snapshot.recentLaunches ?? [], cuts = [0, TAU];
  for (const shot of recent) {
    const carried = shot.originAngleRadians + BOARD_ROTATION_RADIANS_PER_SECOND * (snapshot.tick - shot.tick) / TICK_HZ;
    for (const angle of [shot.originAngleRadians, carried]) for (const side of [-1, 1]) cuts.push(wrap(angle + side * REPEAT_LAUNCH_ANGLE));
  }
  cuts.sort((a, b) => a - b);
  const zones: { start: number; end: number }[] = [];
  for (let n = 1; n < cuts.length; n++) {
    const start = cuts[n - 1]!, end = cuts[n]!;
    if (end - start < 1e-9 || launchHeating(snapshot.tick, snapshot.bestTierThisRun, recent, (start + end) / 2) <= 0) continue;
    const previous = zones.at(-1);
    if (previous?.end === start) previous.end = end;
    else zones.push({ start, end });
  }
  return zones;
}
