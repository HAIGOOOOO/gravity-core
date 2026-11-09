// 見本と計測で同じ入力を使う。物理・射出の可否は本物のsimulationへ任せる。
import { TICK_HZ, LAUNCH_COOLDOWN } from '../game/constants';
import { dropAt } from '../fixtures';
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
  // 終わった結果にも負けた原因があることを確かめるため、最後は同じ側へ連投する。
  const interval = Math.round(LAUNCH_COOLDOWN * TICK_HZ);
  for (let tick = 0; tick < 2 * 60 * TICK_HZ && sim.getSnapshot().phase === 'active'; tick++) {
    if (tick % interval === 0) sim.submitLaunch(dropAt(0));
    sim.stepFixed();
    if (tick % (30 * TICK_HZ) === 0) report((sixMinutes + tick) / TICK_HZ);
  }
  return capture;
}
