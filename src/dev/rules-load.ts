import { randomLaunch } from '../fixtures';
import { LAUNCH_COOLDOWN, TICK_HZ } from '../game/constants';
import { createRng } from '../game/rng';
import { createSimulation } from '../game/simulation';

const DENSE_SEED = 1;
// 実プレイで密集した約93秒の場面。天体数は環境ごとに計測結果へ出す。
const DENSE_START = 11_161;
const SHOT_INTERVAL = Math.round(LAUNCH_COOLDOWN * TICK_HZ);

export function prepareDenseRulesLoad() {
  const simulation = createSimulation(DENSE_SEED);
  const random = createRng(DENSE_SEED + 101);
  const shotAt = (tick: number) => tick % SHOT_INTERVAL === 0 ? randomLaunch(random) : null;
  for (let tick = 0; tick < DENSE_START; tick++) {
    const shot = shotAt(tick);
    if (shot) simulation.submitLaunch(shot);
    simulation.stepFixed();
  }
  return { simulation, shotAt };
}
