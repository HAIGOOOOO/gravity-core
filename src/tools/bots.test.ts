import { describe, expect, it } from 'vitest';
import { TICK_HZ } from '../game/constants';
import { playOnce, summarizeRuns } from './batch';
import { ALL_BOTS, mergeBot, randomBot } from './bots';

const SHORT = 20 * TICK_HZ;
const MEDIUM = 60 * TICK_HZ;

describe('ボットの決定性', () => {
  for (const make of ALL_BOTS) {
    const name = make(0).name;
    it(
      `${name}: 同じシードで 2 回遊ぶと全く同じ結果になる`,
      () => {
        const a = playOnce(make(7), { seed: 7, maxTicks: SHORT });
        const b = playOnce(make(7), { seed: 7, maxTicks: SHORT });
        expect(a.result).toEqual(b.result);
        // 撃った記録まで一致する＝途中の判断も全て同じ
        expect(a.sim.getInputLog()).toEqual(b.sim.getInputLog());
      },
      30_000,
    );
  }
});

describe('ボットの強さ', () => {
  it(
    '狙って合体させるボットは、無作為より平均の合体数が多い',
    () => {
      const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
      const mergeRuns = seeds.map((s) => playOnce(mergeBot(s), { seed: s, maxTicks: MEDIUM }).result);
      const randomRuns = seeds.map((s) => playOnce(randomBot(s), { seed: s, maxTicks: MEDIUM }).result);
      const smart = summarizeRuns(mergeRuns).merges.mean;
      const naive = summarizeRuns(randomRuns).merges.mean;
      expect(smart).toBeGreaterThan(naive);
    },
    60_000,
  );
});
