// 見本と計測で同じ入力を使う。物理・射出の可否は本物のsimulationへ任せる。
import { TICK_HZ, LAUNCH_COOLDOWN } from '../game/constants';
import { dropAt, randomLaunch } from '../fixtures';
import { createRng } from '../game/rng';
import { createReplayCapture } from '../replay/capture';

export function createResultSample(report: (seconds: number) => void = () => {}) {
  const capture = createReplayCapture(7);
  const sim = capture.simulation;
  const sixMinutes = 6 * 60 * TICK_HZ;
  for (let tick = 0; tick < sixMinutes; tick++) {
    if (tick % (8 * TICK_HZ) === 0) sim.submitLaunch(dropAt(-Math.PI / 2));
    sim.stepFixed();
    if (tick % (30 * TICK_HZ) === 0) report(tick / TICK_HZ);
  }
  // 終盤は方角を散らし、限界外の原因天体が記録に残る終了を作る。
  const rng = createRng(1);
  const interval = Math.round(LAUNCH_COOLDOWN * TICK_HZ);
  for (let tick = 0; tick < 2 * 60 * TICK_HZ && sim.getSnapshot().phase === 'active'; tick++) {
    if (tick % interval === 0) sim.submitLaunch(randomLaunch(rng));
    sim.stepFixed();
    if (tick % (30 * TICK_HZ) === 0) report((sixMinutes + tick) / TICK_HZ);
  }
  return capture;
}
