// 題目000の比較実験。通常のテストには混ぜず、同じ種・入力方針で前後を比べる。
import type { BotFactory } from '../tools/bots';
import { randomBot, spiralBot } from '../tools/bots';
import { playOnce, summarizeRuns } from '../tools/batch';
import { DROP_SPEED, GROW_SECONDS, TICK_HZ } from '../game/constants';

const fixed: BotFactory = () => ({
  name: 'fixed',
  decide: () => ({ originAngleRadians: -Math.PI / 2, vx: 0, vy: DROP_SPEED }),
});
const four: BotFactory = () => {
  let shot = 0;
  return { name: 'four', decide: () => {
    const angle = -Math.PI / 2 + (shot++ % 4) * Math.PI / 2;
    return { originAngleRadians: angle, vx: -Math.cos(angle) * DROP_SPEED, vy: -Math.sin(angle) * DROP_SPEED };
  } };
};

export function runRulesBench() {
  const factories = { fixed, four, random: randomBot, spiral: spiralBot };
  const report = Object.entries(factories).map(([name, factory]) => {
    const runs = Array.from({ length: 8 }, (_, i) => {
      const seed = i + 1;
      let lastMergeTick = -Infinity;
      let overflowNearGrowth = 0;
      let cooling = 0;
      const { result } = playOnce(factory(seed), { seed, maxTicks: 5 * 60 * TICK_HZ, hooks: {
        onEvents: (events) => {
          for (const e of events) {
            if (e.kind === 'merge') lastMergeTick = e.tick;
            if (e.kind === 'overLimitStart' && e.tick - lastMergeTick <= Math.ceil(GROW_SECONDS * TICK_HZ)) overflowNearGrowth++;
            if (e.kind === 'merge' || e.kind === 'supernova') cooling -= e.heatDelta ?? 0;
          }
        },
      } });
      return { ...result, overflowNearGrowth, cooling };
    });
    return { name, summary: summarizeRuns(runs), runs };
  });
  return report;
}
