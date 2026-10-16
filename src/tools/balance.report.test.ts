// 数値調整レポート。
// ふだん（test 実行）は各ボット 3 回・60 秒ぶんだけ回して「動く事」を確かめる。
// VITE_BALANCE=1 を付けて vitest を回すと、各ボット 100 回・上限 10 分ぶんを回し、
// 結果を Markdown の表にして console.log に出す（fs / process はこのリポジトリでは型が無いので使わない）。

import { describe, expect, it } from 'vitest';
import { setupAllTiers } from '../fixtures/index';
import { TICK_HZ } from '../game/constants';
import { measureAccuracyBatch, type AccuracySummary, type ShotRecord } from './accuracy';
import { runBatch, summarizeRuns, type PlayResult } from './batch';
import { ALL_BOTS, randomBot } from './bots';
import { diffRuns } from './compare';
import {
  accuracyTable,
  balanceTable,
  diffTable,
  missTable,
  outcomeTable,
  seedTable,
  statsTable,
  tierTable,
} from './report';

const FULL = import.meta.env.VITE_BALANCE === '1';
const RUNS = FULL ? 100 : 3;
const MAX_TICKS = FULL ? 10 * 60 * TICK_HZ : 60 * TICK_HZ;
const TIMEOUT = FULL ? 600_000 : 30_000;

describe('数値調整レポート', () => {
  const collected: { name: string; runs: PlayResult[] }[] = [];
  const accuracies: { name: string; summary: AccuracySummary; shots: ShotRecord[] }[] = [];

  for (const make of ALL_BOTS) {
    const name = make(0).name;
    it(
      `ボット「${name}」を ${RUNS} 回まわせる`,
      () => {
        // 結果と「予測どおりにいったか」を同じまわしで取る（まわし直しの分を増やさない）
        const m = measureAccuracyBatch(make, { runs: RUNS, seedStart: 100, maxTicks: MAX_TICKS });
        expect(m.runs).toHaveLength(RUNS);
        const s = summarizeRuns(m.runs);
        expect(s.launches.mean).toBeGreaterThan(0);
        expect(s.seconds.mean).toBeGreaterThan(0);
        collected.push({ name, runs: m.runs });
        accuracies.push({ name, summary: m.summary, shots: m.shots });
      },
      TIMEOUT,
    );
  }

  it(
    '結果を Markdown の表にできる',
    () => {
      const table = balanceTable(collected);
      expect(table.split('\n')).toHaveLength(ALL_BOTS.length + 2);
      // 全部のボットが同じシードでまわっているので、ボットどうしも対で比べられる
      const paired = diffRuns(collected[0]!.runs, collected[1]!.runs);
      expect(paired.paired).toBe(RUNS);
      if (!FULL) return;

      console.log('\n## GRAVITY CORE 数値レポート（ボット別）\n');
      console.log(table);
      for (const { name, runs } of collected) {
        console.log(`\n${statsTable(name, runs)}`);
        // 異常に早く終わるシードは、調整で条件を絞る手がかりになる
        console.log(`\n${seedTable(name, runs, 8)}`);
      }

      // 予測の的中率。低いボットほど「狙っているのに外れる」ので、出た数字は実力より低い
      console.log('\n## 予測の的中率（ボット別）\n');
      console.log(accuracyTable(accuracies));

      // 外れの内訳（どの結末・どの Tier に散ったか）と個票。
      // 個票の シード+tick から boardBeforeShot で直前の盤面を再現できる
      console.log('\n## 予測の外れの内訳と例（ボット別）\n');
      for (const a of accuracies) {
        console.log(`\n${outcomeTable(a.name, a.shots)}`);
        console.log(`\n${tierTable(a.name, a.shots)}`);
        console.log(`\n${missTable(a.name, a.shots, 12)}`);
      }

      // random を基準に、同じシードどうしの差を出す（シードのばらつきを除いた強さの差）
      const baseline = collected.find((e) => e.name === 'random');
      if (baseline) {
        console.log('\n## ボットの差（random との差・同じシードどうし）\n');
        for (const e of collected) {
          if (e === baseline) continue;
          console.log(`\n${diffTable('random', e.name, baseline.runs, e.runs)}`);
        }
      }

      // setup で変えられる物を変えた比較。random は予測を呼ばないので一番速い
      console.log('\n## setup の差し替え比較（random ボット）\n');
      const normal = runBatch(randomBot, { runs: RUNS, seedStart: 500, maxTicks: MAX_TICKS });
      const variants = [
        {
          name: '熱量30で開始',
          runs: runBatch(randomBot, { runs: RUNS, seedStart: 500, maxTicks: MAX_TICKS, setup: { heat: 30 } }),
        },
        {
          name: 'キュー [4,4,4]',
          runs: runBatch(randomBot, { runs: RUNS, seedStart: 500, maxTicks: MAX_TICKS, setup: { queue: [4, 4, 4] } }),
        },
        {
          // bestTier は出現する天体の確率表（QUEUE_TABLE の行）を変えるので、出現バランスの比較になる
          name: '最高Tier 4 で開始',
          runs: runBatch(randomBot, { runs: RUNS, seedStart: 500, maxTicks: MAX_TICKS, setup: { bestTier: 4 } }),
        },
        {
          name: '全Tier の山あり',
          runs: runBatch(randomBot, { runs: RUNS, seedStart: 500, maxTicks: MAX_TICKS, setup: setupAllTiers() }),
        },
      ];
      console.log(balanceTable([{ name: 'ふつう', runs: normal }, ...variants]));
      // 同じシードどうしの差でも出す（ばらつきを除けるので、小さい差も見える）
      for (const v of variants) {
        console.log(`\n${diffTable('ふつう', v.name, normal, v.runs)}`);
      }
    },
    TIMEOUT,
  );
});
