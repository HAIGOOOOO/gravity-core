// プレイヤーの履歴へ触れず、同じ見本の旧形式と現形式を読み戻して比べる。
import type { RunRecord } from '../contracts/app';
import { TIER_NAMES } from '../game/constants';
import { createStatsStore, STATS_KEY, summarizeTrend, type RunDetailV1 } from '../storage';

export function showLegacyComparison(detail: RunDetailV1): void {
  const legacy: RunRecord = {
    id: `legacy-${detail.id}`, name: '見本', playedAt: detail.playedAt,
    seed: detail.seed, gameVersion: detail.gameVersion, score: detail.score,
    bestTier: detail.bestTier, maxChain: detail.maxChain, seconds: detail.seconds,
    launches: detail.launches, merges: detail.merges, supernovas: detail.supernovas,
  };
  const values = new Map([[STATS_KEY, JSON.stringify({ records: [legacy] })]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const store = createStatsStore(storage);
  store.add(detail);
  const runs = createStatsStore(storage).load().runs;
  const old = runs.find((run) => run.id === legacy.id)!;
  const current = runs.find((run) => run.id === detail.id)!;
  const trend = summarizeTrend(runs);
  const number = (value: number | null): string => value === null
    ? '不明' : value > 0 && value < 0.1
      ? '0.1未満' : value.toLocaleString('ja-JP', { maximumFractionDigits: 1 });
  const rows = [
    ['得点', old.score, current.score, trend.score],
    ['着地した回数', old.lands, current.lands, trend.lands],
    ['限界を越えていた秒数', old.overLimitSeconds, current.overLimitSeconds, trend.overLimitSeconds],
    ['1回で得た最大の点', old.maxSingleScore, current.maxSingleScore, trend.maxSingleScore],
    [`${TIER_NAMES[0]}どうしの合体`, old.mergesByTier?.[0] ?? null, current.mergesByTier?.[0] ?? null, trend.mergesByTier[0]],
  ] as const;
  const table = document.getElementById('legacy-comparison')!;
  table.replaceChildren();
  for (const [label, a, b, metric] of rows) {
    const row = document.createElement('tr');
    const heading = document.createElement('th'); heading.scope = 'row'; heading.textContent = label;
    row.append(heading);
    for (const text of [number(a), number(b), number(metric.average), `${metric.recentKnownCount} / ${trend.recentCount}件`]) {
      const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
    }
    table.append(row);
  }
  document.getElementById('legacy-status')!.textContent = '読み戻した後も、不明な項目は平均の使用件数に入っていません。';
  document.getElementById('legacy-result')!.hidden = false;
}
