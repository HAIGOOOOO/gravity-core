import type { GameEvent, LaunchCommand } from '../contracts/game';
import { GROW_SECONDS, TICK_HZ, TIER_RADIUS } from '../game/constants';
import { createSimulation, restoreSimulation } from '../game/simulation';
import { setupTwoChain } from '../fixtures/chains';
import { setupInterventionPractice } from '../fixtures/intervention';
import { GROWTH_PREVIEW_COMMAND, setupGrowthPreview } from '../fixtures/growth-preview';

export type RuleMode = 'play' | 'learn' | 'collapse' | 'growth' | 1 | 3 | 5;
type Finish = 'chain' | 'growth' | 'collapse' | 'expired' | 'over' | null;

/** 見本も本物の計算を進め、説明の間と結果で時間だけを止める。 */
export function createRuleSession(mode: RuleMode = 'learn', seed = 21) {
  let sim = createSimulation(seed, mode === 'growth' ? setupGrowthPreview() : mode === 'collapse' ? setupInterventionPractice() : mode === 'learn' ? setupTwoChain() : undefined);
  if (typeof mode === 'number') {
    const r = TIER_RADIUS[0];
    const state = createSimulation(seed, { heat: 80, bodies: [{ tier: 0, x: 130, y: -r }, { tier: 0, x: 130, y: r }] }).exportState();
    sim = restoreSimulation({ ...state, bodies: state.bodies.map((b, i) => i ? b : { ...b, chain: mode - 1, chainUntilTick: 300 }) });
  }
  if (mode === 'collapse') sim.stepFixed();
  const before = sim.getSnapshot();
  const prediction = mode === 'growth' ? sim.predict(GROWTH_PREVIEW_COMMAND) : null;
  let prev = before, curr = before;
  let running = mode === 'play' || typeof mode === 'number';
  let waiting = !running, finished: Finish = null, finishAt = Infinity;
  let mergeCooling = 0, interventionCooling = 0, passiveChange = 0, maxChain = 0;
  let resultBodyId: number | null = null;

  function launch(command: LaunchCommand) {
    if (finished) return null;
    const result = sim.submitLaunch(command);
    if (result.accepted) { running = true; waiting = false; curr = sim.getSnapshot(); }
    return result;
  }
  function step(): readonly GameEvent[] {
    if (!running) return [];
    prev = curr;
    const events = sim.stepFixed(); curr = sim.getSnapshot();
    const delta = events.reduce((sum, e) => sum + (e.kind === 'merge' || e.kind === 'supernova' ? e.heatDelta ?? 0 : 0), 0);
    const cooling = curr.intervention?.coolingThisTick ?? 0;
    mergeCooling -= delta; interventionCooling += cooling;
    passiveChange += curr.heat - prev.heat - delta + cooling;
    for (const e of events) {
      if (e.kind !== 'merge' && e.kind !== 'supernova') continue;
      maxChain = Math.max(maxChain, e.chain ?? 0);
      const target = mode === 'growth' || typeof mode === 'number' || (mode === 'learn' && (e.chain ?? 0) >= 2);
      if (target && finishAt === Infinity) {
        // 合体の瞬間で止めず、結果の天体が最大まで成長してから止める。
        finishAt = curr.tick + Math.ceil(GROW_SECONDS * TICK_HZ) + 1;
        resultBodyId = e.kind === 'merge' ? e.bodyIds?.[2] ?? null : null;
      }
    }
    if (curr.phase === 'over') finished = 'over';
    else if (curr.tick >= finishAt) finished = mode === 'growth' ? 'growth' : 'chain';
    else if (mode === 'collapse' && curr.intervention?.used && curr.intervention.activeLeftSeconds === 0) finished = 'collapse';
    else if (mode === 'collapse' && !waiting && curr.intervention?.windowLeftSeconds === 0 && !curr.intervention.used) finished = 'expired';
    if (finished) running = false;
    return events;
  }
  return {
    mode, before, prediction,
    read: () => ({ prev, curr, running, waiting, finished, resultBodyId, mergeCooling, interventionCooling, passiveChange, maxChain,
      score: curr.score - before.score, merges: curr.stats.merges - before.stats.merges }),
    launch,
    collapse() { const result = sim.submitGravity({ kind: 'collapse' }); curr = sim.getSnapshot(); return result; },
    predict: (command: LaunchCommand) => sim.predict(command),
    step,
    togglePause() { if (!waiting && !finished) running = !running; },
  };
}
export type RuleSession = ReturnType<typeof createRuleSession>;
