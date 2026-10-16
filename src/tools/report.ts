// まわした結果を Markdown の表にする。文字列を作るだけ（ファイルには書かない）。

import { RUN_METRICS, summarizeRuns, type PlayResult, type RunMetric } from './batch';
import type { Stats } from './stats';

/** 指標の表示名 */
export const METRIC_LABELS: Record<RunMetric, string> = {
  seconds: '続いた秒数',
  score: '得点',
  bestTier: '到達Tier',
  merges: '合体数',
  maxChain: '最大連鎖',
  heat75Count: '熱量75超',
  launches: '射出数',
  supernovas: '超新星',
};

/** 数値の表示。整数はそのまま、小数は 1 桁、NaN/無限は「—」。 */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(1);
}

/** 「中央値（10%〜90%）」の形。 */
export function formatRange(s: Stats): string {
  return `${formatNumber(s.median)}（${formatNumber(s.p10)}〜${formatNumber(s.p90)}）`;
}

/** 汎用の Markdown 表。 */
export function markdownTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const sep = headers.map(() => '---');
  return [`| ${headers.join(' | ')} |`, `| ${sep.join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

/** ボットどうし（または設定どうし）を並べた比較表。各マスは「中央値（10%〜90%）」。 */
export function balanceTable(entries: readonly { name: string; runs: readonly PlayResult[] }[]): string {
  return markdownTable(
    ['ボット', '回数', '秒数', '得点', '到達Tier', '合体数', '最大連鎖', '熱量75超（平均）', '打ち切り'],
    entries.map(({ name, runs }) => {
      const s = summarizeRuns(runs);
      const timeouts = runs.filter((r) => r.timedOut).length;
      return [
        name,
        String(runs.length),
        formatRange(s.seconds),
        formatRange(s.score),
        formatRange(s.bestTier),
        formatRange(s.merges),
        formatRange(s.maxChain),
        formatNumber(s.heat75Count.mean),
        String(timeouts),
      ];
    }),
  );
}

/** 1 つのまとめを指標ごとに並べた詳しい表。 */
export function statsTable(name: string, runs: readonly PlayResult[]): string {
  const s = summarizeRuns(runs);
  const table = markdownTable(
    ['指標', '平均', '中央値', '10%', '90%', '最小', '最大'],
    RUN_METRICS.map((m) => {
      const st = s[m];
      return [
        METRIC_LABELS[m],
        formatNumber(st.mean),
        formatNumber(st.median),
        formatNumber(st.p10),
        formatNumber(st.p90),
        formatNumber(st.min),
        formatNumber(st.max),
      ];
    }),
  );
  return `### ${name}\n\n${table}`;
}
