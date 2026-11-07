// 自分のプレイは計算が終わるたびに記録する。結果画面で同じ物理を回し直さない。
import type { GameEvent, GameSnapshot, SimulationPort } from '../contracts/game';
import { createSimulation, type SimulationSetup } from '../game/simulation';
import { CHECKPOINT_EVERY, type IndexedEvent, type ReplayCheckpoint, type ReplayRun } from './engine';
import { HEAT_STATE_LIMITS } from '../game/constants';
import { createReplayRecord, copySetup, type ReplayRecord } from './record';
import { highlightsFromRun, type ReplayHighlight } from './highlights';
import { causeFromRun, type DefeatCause } from './cause';
import { playerFromRun, type ReplayStart } from './player';

const MAX_CHECKPOINTS = 720;

export type CapturedReplay = Readonly<{
  record: ReplayRecord;
  highlights: readonly ReplayHighlight[];
  cause: DefeatCause | null;
  /** 結果の表示だけなら呼ばなくてよい。プレイヤーにも同じ計算結果を渡す。 */
  createPlayer(): ReplayStart;
}>;

/**
 * 本体は返り値のsimulationを普段どおり進め、結果の時にfinishを呼ぶ。
 * 外部から受け取った記録はこの口へ渡せない。parse→検証の既存の経路を使う。
 */
export function createReplayCapture(seed: number, setup?: SimulationSetup): {
  simulation: SimulationPort;
  finish(): CapturedReplay;
} {
  const initialSetup = setup === undefined ? undefined : copySetup(setup);
  const sim = createSimulation(seed, initialSetup);
  const initial = sim.getSnapshot();
  const events: IndexedEvent[] = [];
  let snapshots: GameSnapshot[] = [initial];
  let states: ReplayCheckpoint[] = [{ state: sim.exportState(), nextInput: 0 }];
  let every = CHECKPOINT_EVERY;
  let critical: GameSnapshot | null = initial.heat >= HEAT_STATE_LIMITS[2] ? initial : null;
  let lastHeatRise: GameSnapshot | null = null;
  let revision = 0;
  let finishedRevision = -1;
  let cached: CapturedReplay | null = null;

  const simulation: SimulationPort = {
    getSnapshot: () => sim.getSnapshot(),
    getInputLog: () => sim.getInputLog(),
    getGravityLog: () => sim.getGravityLog(),
    predict: (command) => sim.predict(command),
    submitGravity: (command) => sim.submitGravity(command),
    submitLaunch(command) {
      const result = sim.submitLaunch(command);
      if (result.accepted) revision++;
      return result;
    },
    stepFixed() {
      const before = sim.getSnapshot();
      const surfaced = sim.stepFixed();
      const after = sim.getSnapshot();
      // 終了後に呼ばれても、同じtickの保存点と出来事を重ねない。
      if (after.tick === before.tick) return surfaced;
      revision++;
      for (const event of surfaced) events.push({ at: after.tick, event });
      if (critical === null && after.heat >= HEAT_STATE_LIMITS[2]) critical = after;
      if (surfaced.some((event: GameEvent) => event.kind === 'overLimitStart')) lastHeatRise = after;
      if (after.tick % every === 0) {
        snapshots.push(after);
        states.push({ state: sim.exportState(), nextInput: sim.getInputLog().length });
        if (states.length > MAX_CHECKPOINTS) {
          // 長く遊んでも増え続けない。捨てるのは保存点だけで、入力と出来事は残す。
          snapshots = snapshots.filter((_, index) => index % 2 === 0);
          states = states.filter((_, index) => index % 2 === 0);
          every *= 2;
        }
      }
      return surfaced;
    },
  };

  return {
    simulation,
    finish() {
      if (cached && revision === finishedRevision) return cached;
      const record = createReplayRecord(sim, { setup: initialSetup });
      // 途中で保存した後も遊べるよう、増える配列はこの時点で切り離す。
      const run: ReplayRun = {
        ok: true, events: events.slice(), checkpoints: snapshots.slice(), states: states.slice(),
        checkpointEvery: every, critical, lastHeatRise, final: sim.getSnapshot(),
      };
      cached = {
        record, highlights: highlightsFromRun(run), cause: causeFromRun(run),
        createPlayer: () => playerFromRun(record, run),
      };
      finishedRevision = revision;
      return cached;
    },
  };
}
