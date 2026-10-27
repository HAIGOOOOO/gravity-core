import type { GameEvent, LaunchCommand } from '../contracts/game';
import { CORE_RADIUS, DROP_SPEED, GROW_SECONDS, TICK_HZ, TIER_RADIUS } from '../game/constants';
import { createSimulation, restoreSimulation } from '../game/simulation';
import { GROWTH_PREVIEW_COMMAND, setupGrowthPreview } from '../fixtures/growth-preview';
import { createInterventionPreparation, createPressurePractice } from './rules-practice';

export type RuleMode = 'play' | 'learn' | 'collapse' | 'growth' | 'repeat' | 'loss' | 'loss-repeat' | 1 | 3 | 5;
type Finish = 'chain' | 'growth' | 'collapse' | 'expired' | 'repeat' | 'over' | null;

/** 見本も本物の計算を進め、説明の間と結果で時間だけを止める。 */
export function createRuleSession(mode: RuleMode = 'learn', seed = 21, pauseForIntervention = false, prepareIntervention = false) {
  let sim = mode === 'learn' || mode === 'collapse' ? createPressurePractice(seed, mode === 'collapse') : createSimulation(seed, mode === 'growth' ? setupGrowthPreview() : undefined);
  let preparation: 'unlock' | 'charge' | 'ready' | null = mode === 'collapse' && prepareIntervention ? 'unlock' : null;
  if (preparation) sim = createInterventionPreparation(seed);
  if (typeof mode === 'number') {
    const r = TIER_RADIUS[0];
    const state = createSimulation(seed, { heat: 80, bodies: [{ tier: 0, x: 130, y: -r }, { tier: 0, x: 130, y: r }] }).exportState();
    sim = restoreSimulation({ ...state, bodies: state.bodies.map((b, i) => i ? b : { ...b, chain: mode - 1, chainUntilTick: 300 }) });
  }
  if (mode === 'loss') sim = restoreSimulation({ ...createPressurePractice(seed, true).exportState(), heat: 99 });
  if (mode === 'repeat') {
    // 衛星のある途中盤面から、履歴のない最初の一投を本人に操作してもらう。
    sim = createSimulation(seed, { heat: 40, bestTier: 3, bodies: [{ tier: 3, x: 0, y: -CORE_RADIUS - TIER_RADIUS[3] }] });
  }
  if (mode === 'loss-repeat') {
    // 実際に同じ方角へ投げて衛星まで育てる。練習開始前の得点は後で差し引く。
    for (let n = 0; n < 20 * TICK_HZ && sim.getSnapshot().phase === 'active'; n++) {
      const s = sim.getSnapshot();
      if (s.launchCooldownLeftSeconds <= 0) {
        if (s.bestTierThisRun >= 3 && (s.recentLaunches?.length ?? 0) >= 3) break;
        sim.submitLaunch({ originAngleRadians: 0, vx: -DROP_SPEED, vy: 0 });
      }
      sim.stepFixed();
    }
    if (mode === 'loss-repeat') sim = restoreSimulation({ ...sim.exportState(), heat: 99 });
  }
  const before = sim.getSnapshot();
  const prediction = mode === 'growth' ? sim.predict(GROWTH_PREVIEW_COMMAND) : null;
  let prev = before, curr = before;
  let running = mode === 'play' || typeof mode === 'number';
  let waiting = !running, finished: Finish = null, finishAt = Infinity;
  let mergeCooling = 0, interventionCooling = 0, passiveChange = 0, maxChain = 0;
  let overflowHeating = 0, ambientCooling = 0;
  let shotHeating = 0;
  const shots: { angle: number; heat: number }[] = [];
  let armed = false;
  let resultBodyId: number | null = null;
  let lastFusion: { before: number; after: number; cooling: number } | null = null;

  function launch(command: LaunchCommand) {
    if (finished || (preparation && preparation !== 'ready') || (mode === 'repeat' && !waiting)) return null;
    const heatBefore = sim.getSnapshot().heat;
    const result = sim.submitLaunch(command);
    if (result.accepted) {
      armed = mode === 'collapse' && pauseForIntervention;
      running = !armed; waiting = false; curr = sim.getSnapshot(); shotHeating += curr.heat - heatBefore;
      shots.push({ angle: command.originAngleRadians, heat: curr.heat - heatBefore });
      if (mode === 'repeat' && shots.length >= 3) finishAt = curr.tick + 1;
    }
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
    const passive = curr.heat - prev.heat - delta + cooling;
    passiveChange += passive;
    if (curr.overLimit) overflowHeating += Math.max(0, passive);
    else ambientCooling += Math.max(0, -passive);
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
    else if (mode === 'collapse' && shots.length > 0 && !waiting && curr.intervention?.windowLeftSeconds === 0 && !curr.intervention.used) finished = 'expired';
    if (finished) running = false;
    else if (preparation === 'unlock' && curr.intervention?.unlocked && curr.bodies.some(b => b.tier === 3 && b.radius === TIER_RADIUS[3])) {
      running = false; waiting = true; preparation = 'charge';
    } else if (preparation === 'charge' && curr.intervention && curr.intervention.charge === curr.intervention.max) {
      running = false; waiting = true; preparation = 'ready';
    }
    else if (mode === 'repeat' && curr.launchCooldownLeftSeconds <= 0) {
      // 速さの制限を変えず、次の選択ができる時点でだけ教材の時計を止める。
      running = false; waiting = true;
    }
    return events;
  }
  return {
    mode, before, prediction,
    read: () => ({ prev, curr, running, waiting, armed, finished, preparation, resultBodyId, lastFusion, shotHeating, shots: [...shots], mergeCooling, interventionCooling, passiveChange, overflowHeating, ambientCooling, maxChain,
      score: curr.score - before.score, merges: curr.stats.merges - before.stats.merges }),
    launch,
    collapse() { const result = sim.submitGravity({ kind: 'collapse' }); curr = sim.getSnapshot(); if (result.accepted) { armed = false; running = true; } return result; },
    predict: (command: LaunchCommand) => sim.predict(command),
    startLoss() { if (mode === 'loss' && waiting) { waiting = false; running = true; } },
    advancePreparation() { if (waiting && (preparation === 'unlock' || preparation === 'charge')) { waiting = false; running = true; } },
    step,
    togglePause() { if (!waiting && !finished && !armed) running = !running; },
  };
}
export type RuleSession = ReturnType<typeof createRuleSession>;
