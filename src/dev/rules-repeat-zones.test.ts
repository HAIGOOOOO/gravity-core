import { expect, it } from 'vitest';
import { createSimulation } from '../game/simulation';
import { launchHeating } from '../game/launch-heat';
import { TICK_HZ } from '../game/constants';
import { repeatHeatingZones } from './rules-repeat-zones';

it('危険な帯は、回転で流れた方角と0度の折返しも本体の加熱判定へ一致する', () => {
  const base = createSimulation(1).getSnapshot();
  const snapshots = [
    { ...base, bestTierThisRun: 3 as const, tick: TICK_HZ, recentLaunches: [{ tick: 0, originAngleRadians: 0 }, { tick: 60, originAngleRadians: 0 }] },
    { ...base, bestTierThisRun: 2 as const, tick: TICK_HZ, recentLaunches: [{ tick: 0, originAngleRadians: 0 }, { tick: 60, originAngleRadians: 0 }] },
  ];
  for (const snapshot of snapshots) {
    const zones = repeatHeatingZones(snapshot);
    for (let n = 0; n < 720; n++) {
      const angle = (n + .37) * Math.PI * 2 / 720;
      const hot = launchHeating(snapshot.tick, snapshot.bestTierThisRun, snapshot.recentLaunches, angle) > 0;
      expect(zones.some(zone => angle > zone.start && angle < zone.end)).toBe(hot);
    }
  }
});
