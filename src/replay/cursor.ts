// 復元した計算は最大 1 本だけ持つ。巻き戻しでも直前の保存点から再開する。
import type { Tick } from '../contracts/game';
import type { InputAction } from '../shared/input-timeline';
import { restoreSimulation, type Simulation } from '../game/simulation';
import type { ReplayCheckpoint } from './engine';

export function createReplayCursor(
  states: readonly ReplayCheckpoint[], inputs: readonly InputAction[], endTick: Tick,
) {
  let sim: Simulation | null = null;
  let nextInput = 0;
  const applyDue = (): void => {
    const tick = sim!.getSnapshot().tick;
    while (nextInput < inputs.length && inputs[nextInput]!.tick === tick) {
      const action = inputs[nextInput++]!;
      if (action.kind === 'launch') sim!.submitLaunch(action.input);
      else sim!.submitGravity({ kind: 'collapse' });
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
