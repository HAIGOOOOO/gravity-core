import type { RecentLaunch } from '../game/launch-heat';

const FULL_TURN = 2 * Math.PI;
const ZONES = 4;
const WINDOW = 2 * ZONES;

const wrap = (angle: number) => (angle % FULL_TURN + FULL_TURN) % FULL_TURN;
const distance = (a: number, b: number) => {
  const direct = Math.abs(wrap(a) - wrap(b));
  return Math.min(direct, FULL_TURN - direct);
};

/** 計測専用。直近8投のすべてを、互いに離れた4組の近い方角に分けられるか。 */
export function repeatedFourZones(recent: readonly RecentLaunch[], next: number, tolerance: number): boolean {
  if (recent.length !== WINDOW) return false;
  const sorted = recent.map(shot => wrap(shot.originAngleRadians)).sort((a, b) => a - b);
  // 円周上で隣り合うペア。ペアが0をまたぐ並べ方も試す。
  for (const offset of [0, 1]) {
    let valid = true;
    let nextInPair = false;
    for (let pair = 0; pair < ZONES; pair++) {
      const index = offset + 2 * pair;
      const first = sorted[index]!;
      const second = sorted[(index + 1) % WINDOW]!;
      const following = sorted[(index + 2) % WINDOW]!;
      if (wrap(second - first) > tolerance || wrap(following - second) <= 2 * tolerance) {
        valid = false;
        break;
      }
      if (distance(next, first) <= tolerance && distance(next, second) <= tolerance) nextInPair = true;
    }
    if (valid && nextInPair) return true;
  }
  return false;
}
