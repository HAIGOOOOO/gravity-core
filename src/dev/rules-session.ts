import type { GameEvent, LaunchCommand } from '../contracts/game';
import { DROP_SPEED, GROW_SECONDS, TICK_HZ, TIER_RADIUS } from '../game/constants';
import { createSimulation, restoreSimulation } from '../game/simulation';
import { GROWTH_PREVIEW_COMMAND, setupGrowthPreview } from '../fixtures/growth-preview';
import { createPressurePractice } from './rules-practice';

export type RuleMode = 'play' | 'learn' | 'collapse' | 'growth' | 'repeat' | 1 | 3 | 5;
type Finish = 'chain' | 'growth' | 'collapse' | 'expired' | 'repeat' | 'over' | null;

/** 見本も本物の計算を進め、説明の間と結果で時間だけを止める。 */
export function createRuleSession(mode: RuleMode = 'learn', seed = 21) {
  let sim = mode === 'learn' || mode === 'collapse' ? createPressurePractice(seed, mode === 'collapse') : createSimulation(seed, mode === 'growth' ? setupGrowthPreview() : undefined);
  if (typeof mode === 'number') {
    const r = TIER_RADIUS[0];
    const state = createSimulation(seed, { heat: 80, bodies: [{ tier: 0, x: 130, y: -r }, { tier: 0, x: 130, y: r }] }).exportState();
    sim = restoreSimulation({ ...state, bodies: state.bodies.map((b, i) => i ? b : { ...b, chain: mode - 1, chainUntilTick: 300 }) });
  }
  if (mode === 'repeat') {
    // 実際に同じ方角へ投げて衛星まで育てる。練習開始前の得点は後で差し引く。
    for (let n = 0; n < 20 * TICK_HZ && sim.getSnapshot().phase === 'active'; n++) {
      const s = sim.getSnapshot();
      if (s.launchCooldownLeftSeconds <= 0) {
        if (s.bestTierThisRun >= 3 && (s.recentLaunches?.length ?? 0) >= 3) break;
        sim.submitLaunch({ originAngleRadians: 0, vx: -DROP_SPEED, vy: 0 });
      }
      sim.stepFixed();
    }
  }
  const before = sim.getSnapshot();
  const prediction = mode === 'growth' ? sim.predict(GROWTH_PREVIEW_COMMAND) : null;
  let prev = before, curr = before;
  let running = mode === 'play' || typeof mode === 'number';
  let waiting = !running, finished: Finish = null, finishAt = Infinity;
  let mergeCooling = 0, interventionCooling = 0, passiveChange = 0, maxChain = 0;
  let shotHeating = 0;
  let resultBodyId: number | null = null;
  let lastFusion: { before: number; after: number; cooling: number } | null = null;

  function launch(command: LaunchCommand) {
    if (finished) return null;
    const result = sim.submitLaunch(command);
    if (result.accepted) { running = true; waiting = false; curr = sim.getSnapshot(); shotHeating += result.heatDelta ?? 0; if (mode === 'repeat') finishAt = curr.tick + 1; }
    return result;
  }
  function step(): readonly GameEvent[] {
    if (!running) return [];
    prev = curr;
    const events = sim.stepFixed(); curr = sim.getSnapshot();
    const delta = events.reduce((sum, e) => sum + (e.kind === 'merge' || e.kind === 'supernova' ? e.heatDelta ?? 0 : 0), 0);
    const cooling = curr.intervention?.coolingThisTick ?? 0;
    // 合体は自然変化より先。教材では射出前との比較に埋もれないよう瞬間の冷却も残す。
    if (delta < 0) lastFusion = { before: prev.heat, after: prev.heat + delta, cooling: -delta };
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
    else if (curr.tick >= finishAt) finished = mode === 'growth' ? 'growth' : mode === 'repeat' ? 'repeat' : 'chain';
    else if (mode === 'collapse' && curr.intervention?.used && curr.intervention.activeLeftSeconds === 0) finished = 'collapse';
    else if (mode === 'collapse' && !waiting && curr.intervention?.windowLeftSeconds === 0 && !curr.intervention.used) finished = 'expired';
    if (finished) running = false;
    return events;
  }
  return {
    mode, before, prediction,
    read: () => ({ prev, curr, running, waiting, finished, resultBodyId, lastFusion, shotHeating, mergeCooling, interventionCooling, passiveChange, maxChain,
      score: curr.score - before.score, merges: curr.stats.merges - before.stats.merges }),
    launch,
    collapse() { const result = sim.submitGravity({ kind: 'collapse' }); curr = sim.getSnapshot(); return result; },
    predict: (command: LaunchCommand) => sim.predict(command),
    step,
    togglePause() { if (!waiting && !finished) running = !running; },
  };
}
export type RuleSession = ReturnType<typeof createRuleSession>;
