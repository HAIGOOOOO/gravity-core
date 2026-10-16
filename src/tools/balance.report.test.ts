// 数値調整レポート。
// ふだん（test 実行）は各ボット 3 回・60 秒ぶんだけ回して「動く事」を確かめる。
// VITE_BALANCE=1 を付けて vitest を回すと、各ボット 100 回・上限 10 分ぶんを回し、
// 結果を Markdown の表にして console.log に出す（fs / process はこのリポジトリでは型が無いので使わない）。

import { describe, expect, it } from 'vitest';
import { TICK_HZ } from '../game/constants';
import { runBatch, summarizeRuns, type PlayResult } from './batch';
import { ALL_BOTS, randomBot } from './bots';
import { balanceTable, statsTable } from './report';

const FULL = import.meta.env.VITE_BALANCE === '1';
const RUNS = FULL ? 100 : 3;
const MAX_TICKS = FULL ? 10 * 60 * TICK_HZ : 60 * TICK_HZ;
const TIMEOUT = FULL ? 600_000 : 30_000;

describe('数値調整レポート', () => {
  const collected: { name: string; runs: PlayResult[] }[] = [];

  for (const make of ALL_BOTS) {
    const name = make(0).name;
    it(
      `ボット「${name}」を ${RUNS} 回まわせる`,
      () => {
        const runs = runBatch(make, { runs: RUNS, seedStart: 100, maxTicks: MAX_TICKS });
        expect(runs).toHaveLength(RUNS);
        const s = summarizeRuns(runs);
        expect(s.launches.mean).toBeGreaterThan(0);
        expect(s.seconds.mean).toBeGreaterThan(0);
        collected.push({ name, runs });
      },
      TIMEOUT,
    );
  }

  it(
    '結果を Markdown の表にできる',
    () => {
      const table = balanceTable(collected);
      expect(table.split('\n')).toHaveLength(ALL_BOTS.length + 2);
      if (!FULL) return;

      console.log('\n## GRAVITY CORE 数値レポート（ボット別）\n');
      console.log(table);
      for (const { name, runs } of collected) console.log(`\n${statsTable(name, runs)}`);

      // setup で変えられる物を変えた比較。random は予測を呼ばないので一番速い
      console.log('\n## setup の差し替え比較（random ボット）\n');
      console.log(
        balanceTable([
          { name: 'ふつう', runs: runBatch(randomBot, { runs: RUNS, seedStart: 500, maxTicks: MAX_TICKS }) },
          {
            name: '熱量30で開始',
            runs: runBatch(randomBot, { runs: RUNS, seedStart: 500, maxTicks: MAX_TICKS, setup: { heat: 30 } }),
          },
          {
            name: 'キュー [4,4,4]',
            runs: runBatch(randomBot, { runs: RUNS, seedStart: 500, maxTicks: MAX_TICKS, setup: { queue: [4, 4, 4] } }),
          },
        ]),
      );
    },
    TIMEOUT,
  );
});
