// 復元した計算は最大 1 本だけ持つ。巻き戻しでも直前の保存点から再開する。
import type { LaunchInput, Tick } from '../contracts/game';
import { restoreSimulation, type Simulation } from '../game/simulation';
import type { ReplayCheckpoint } from './engine';

export function createReplayCursor(
  states: readonly ReplayCheckpoint[], inputs: readonly LaunchInput[], endTick: Tick,
) {
  let sim: Simulation | null = null;
  let nextInput = 0;
  const applyDue = (): void => {
    const tick = sim!.getSnapshot().tick;
    while (nextInput < inputs.length && inputs[nextInput]!.tick === tick) {
      sim!.submitLaunch(inputs[nextInput++]!);
    }
  };
  return {
    at(target: Tick) {
      // 保存点は tick 昇順。入力反映前の状態と次の入力番号を一緒に復元する。
      let lo = 0;
      let hi = states.length;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >>> 1;
        if (states[mid]!.state.tick <= target) lo = mid;
        else hi = mid;
      }
      const checkpoint = states[lo]!;
      const tick = sim?.getSnapshot().tick ?? -1;
      if (!sim || tick > target || tick < checkpoint.state.tick) {
        sim = restoreSimulation(checkpoint.state);
        nextInput = checkpoint.nextInput;
      }
      while (sim.getSnapshot().tick < target && sim.getSnapshot().phase === 'active') {
        applyDue();
        sim.stepFixed();
      }
      if (sim.getSnapshot().tick === endTick) applyDue();
      return sim.getSnapshot();
    },
    get count() { return sim ? 1 : 0; },
    get approxBytes() { return sim ? JSON.stringify(sim.exportState()).length : 0; },
  };
}
