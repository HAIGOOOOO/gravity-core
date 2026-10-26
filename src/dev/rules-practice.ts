import { CORE_RADIUS, LIMIT_GRACE_SECONDS, LIMIT_RADIUS, TICK_HZ, TIER_RADIUS } from '../game/constants';
import { createSimulation, restoreSimulation, type SimulationSetup } from '../game/simulation';
import { setupTwoChain } from '../fixtures/chains';
import { setupInterventionPractice } from '../fixtures/intervention';

/** 限界外に支えられた山を置き、待つだけでは熱が下がらない途中盤面から練習する。 */
export function createPressurePractice(seed: number, collapse: boolean) {
  const inner = CORE_RADIUS + TIER_RADIUS[6];
  const middle = inner + TIER_RADIUS[6] + TIER_RADIUS[5];
  const outer = middle + TIER_RADIUS[5] + TIER_RADIUS[4];
  const setup: SimulationSetup = {
    ...setupTwoChain(), heat: 70, bestTier: 6,
    bodies: [
      ...(collapse ? [{ tier: 0 as const, x: 0, y: -CORE_RADIUS - TIER_RADIUS[0] }] : setupTwoChain().bodies!),
      { tier: 6, x: 0, y: inner }, { tier: 5, x: 0, y: middle }, { tier: 4, x: 0, y: outer },
    ],
  };
  const state = createSimulation(seed, setup).exportState();
  // 満タンの練習を用意するためだけに、別の計算で本物の12合体を起こす。
  // 準備の得点・天体・入力は練習の成績へ混ぜない。
  const preparation = createSimulation(seed, setupInterventionPractice());
  if (collapse) preparation.stepFixed();
  const burst = preparation.exportState().gravity!.burst;
  // 連鎖は成長直後の猶予が0.4秒残る場面。自然変化が正でも、合体で開始時より冷える。
  const graceLeft = collapse ? 0 : .4;
  return restoreSimulation({ ...state, overLimit: collapse,
    gravity: { ...state.gravity!, burst },
    bodies: state.bodies.map(b => ({ ...b, bornTick: -Math.ceil((LIMIT_GRACE_SECONDS - graceLeft) * TICK_HZ),
      overLimit: collapse && Math.hypot(b.x, b.y) + b.radius > LIMIT_RADIUS })),
  });
}
