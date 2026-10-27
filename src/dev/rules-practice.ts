import { BURST_MAX, CORE_RADIUS, LIMIT_GRACE_SECONDS, LIMIT_RADIUS, TICK_HZ, TIER_RADIUS } from '../game/constants';
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

/** 衛星の解放、合体による蓄積、射出を同じ盤面の時間軸で確かめる。 */
export function createInterventionPreparation(seed: number) {
  const bodies: NonNullable<SimulationSetup['bodies']>[number][] = [
    { tier: 2, x: -TIER_RADIUS[2], y: -CORE_RADIUS - TIER_RADIUS[2] },
    { tier: 2, x: TIER_RADIUS[2], y: -CORE_RADIUS - TIER_RADIUS[2] },
  ];
  for (let pair = 0; pair < BURST_MAX - 1; pair++) {
    const angle = pair * Math.PI * 2 / (BURST_MAX - 1), radius = 220;
    for (const side of [-1, 1]) bodies.push({ tier: 0,
      x: Math.cos(angle) * radius - Math.sin(angle) * side * 22,
      y: Math.sin(angle) * radius + Math.cos(angle) * side * 22,
    });
  }
  return createSimulation(seed, { bodies, bestTier: 2, heat: 95, queue: [0, 0, 0] });
}
