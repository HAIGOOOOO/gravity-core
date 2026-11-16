import type { RecentLaunch } from '../game/launch-heat';

const FULL_TURN = 2 * Math.PI;
const ZONES = 4;

const wrap = (angle: number) => (angle % FULL_TURN + FULL_TURN) % FULL_TURN;
const distance = (a: number, b: number) => {
  const direct = Math.abs(wrap(a) - wrap(b));
  return Math.min(direct, FULL_TURN - direct);
};

/** 計測専用。直近の射出を、同じ投数ずつの離れた4方角に分けられるか。 */
export function repeatedFourZones(recent: readonly RecentLaunch[], next: number, tolerance: number, visits: 2 | 3 = 2): boolean {
  const window = ZONES * visits;
  if (recent.length !== window) return false;
  const sorted = recent.map(shot => wrap(shot.originAngleRadians)).sort((a, b) => a - b);
  // 円周で隣り合う投を組にする。組の途中に0度が来る並べ方も試す。
  for (let offset = 0; offset < visits; offset++) {
    let valid = true;
    let nextInZone = false;
    for (let zone = 0; zone < ZONES; zone++) {
      const index = offset + visits * zone;
      const first = sorted[index]!;
      const last = sorted[(index + visits - 1) % window]!;
      const following = sorted[(index + visits) % window]!;
      if (wrap(last - first) > tolerance || wrap(following - last) <= 2 * tolerance) {
        valid = false;
        break;
      }
      if (distance(next, first) <= tolerance && distance(next, last) <= tolerance) nextInZone = true;
    }
    if (valid && nextInZone) return true;
  }
  return false;
}

/** 計測専用。離れた4方向を回る射出の中に、最大3投だけ別の方角が混ざる場合も調べる。 */
export function repeatedFourAxes(recent: readonly RecentLaunch[], next: number): boolean {
  if (recent.length !== 16) return false;
  const quarter = FULL_TURN / ZONES;
  const sectorWidth = Math.PI / 6;
  const rays = recent.map(launch => wrap(launch.originAngleRadians));
  // 各候補は、選択中か過去の射出が帯の左端に乗る向き。直角にずれた帯を4本置く。
  for (const ray of [wrap(next), ...rays]) {
    const start = ray % quarter;
    if (wrap(next - start) % quarter > sectorWidth) continue;
    const counts = [0, 0, 0, 0];
    let matched = 0;
    for (const angle of rays) {
      const offset = wrap(angle - start);
      const sector = Math.floor(offset / quarter);
      if (offset % quarter > sectorWidth) continue;
      counts[sector]!++;
      matched++;
    }
    if (matched >= 13 && counts.every(count => count >= 3)) return true;
  }
  return false;
}
