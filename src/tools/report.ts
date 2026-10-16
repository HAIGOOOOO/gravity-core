// まわした結果を Markdown の表にする。文字列を作るだけ（ファイルには書かない）。

import { countOutcomes, mergeMisses, SHOT_OUTCOMES, type AccuracySummary, type ShotOutcome, type ShotRecord } from './accuracy';
import { RUN_METRICS, summarizeRuns, type PlayResult, type RunMetric } from './batch';
import { diffRuns } from './compare';
import type { Stats } from './stats';

/** 指標の表示名 */
export const METRIC_LABELS: Record<RunMetric, string> = {
  seconds: '続いた秒数',
  score: '得点',
  bestTier: '到達Tier',
  merges: '合体数',
  mergesPerLaunch: '合体効率',
  maxChain: '最大連鎖',
  heat75Count: '熱量75超',
  peakHeat: '最高熱量',
  overLimitSeconds: '限界越え秒',
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

/** 割合の表示。0〜1 を % にする。NaN/無限は「—」。 */
export function formatPercent(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return `${Math.round(v * 100)}%`;
}

/** 汎用の Markdown 表。 */
export function markdownTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const sep = headers.map(() => '---');
  return [`| ${headers.join(' | ')} |`, `| ${sep.join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

/** ボットどうし（または設定どうし）を並べた比較表。各マスは「中央値（10%〜90%）」。 */
export function balanceTable(entries: readonly { name: string; runs: readonly PlayResult[] }[]): string {
  return markdownTable(
    ['ボット', '回数', '秒数', '得点', '到達Tier', '合体数', '合体効率', '最大連鎖', '限界越え秒', '熱量Max', '熱量75超（平均）', '打ち切り'],
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
        formatNumber(s.mergesPerLaunch.mean),
        formatRange(s.maxChain),
        formatRange(s.overLimitSeconds),
        formatRange(s.peakHeat),
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

/**
 * 「A → B（同じシードどうし）」の差の表。各行は指標で、「B − A」の分布を出す。
 * 分布どうしの見比べよりシードのばらつきを除けるので、小さい差も見えやすい。
 * 件名には対の数と、両側の打ち切り数（A→B）を出す。
 */
export function diffTable(nameA: string, nameB: string, a: readonly PlayResult[], b: readonly PlayResult[]): string {
  const d = diffRuns(a, b);
  const sa = summarizeRuns(a);
  const sb = summarizeRuns(b);
  const timeoutsA = a.filter((r) => r.timedOut).length;
  const timeoutsB = b.filter((r) => r.timedOut).length;
  const table = markdownTable(
    ['指標', `${nameA} 中央値`, `${nameB} 中央値`, '差の中央値', '差の10%', '差の90%'],
    RUN_METRICS.map((m) => [
      METRIC_LABELS[m],
      formatNumber(sa[m].median),
      formatNumber(sb[m].median),
      formatNumber(d.deltas[m].median),
      formatNumber(d.deltas[m].p10),
      formatNumber(d.deltas[m].p90),
    ]),
  );
  return `### ${nameA} → ${nameB}（${d.paired} 対・打ち切り ${timeoutsA}→${timeoutsB}）\n\n${table}`;
}

/**
 * 「予測どおりにいったか」の表。ボット別に的中率を並べる。
 * 的中率が低い = 予測が見ていない盤面の動きで狙いが外れる = そのボットの数字は実力より低く出ている。
 * 相手一致 = 合体した時、相手が予測どおりだった率（外れて別の相手に当たった分を見分ける）。
 * 着地誤差 = 着地した位置と予測の点の距離（px）の中央値。
 */
export function accuracyTable(entries: readonly { name: string; summary: AccuracySummary }[]): string {
  return markdownTable(
    ['ボット', '射出', '予測合体', '的中', '的中率', '外れ', '予測外合体', '着地後合体', '相手一致', '着地誤差px'],
    entries.map(({ name, summary: s }) => [
      name,
      String(s.shots),
      String(s.predictedMerges),
      String(s.mergeHits),
      formatPercent(s.mergeHitRate),
      String(s.mergeMisses),
      String(s.surpriseMerges),
      String(s.landedThenMerged),
      formatPercent(s.partnerMatchRate),
      formatNumber(s.landError.median),
    ]),
  );
}

/** 結末の表示名 */
const OUTCOME_LABELS: Record<ShotOutcome, string> = {
  merged: '合体',
  landed: '着地',
  landedThenMerged: '着地→合体',
  noContact: '未接触',
};

/**
 * 「合体を予測したか」×「実際の結末」の件数表。
 * 外れが「着地」「着地→合体」「未接触」のどれに散るかで原因の当たりを付ける:
 *   - 着地が多い → 狙いは合っていたが相手が先に動いた（盤面の揺れ）
 *   - 未接触が多い → 途中で弾かれた等、道すじ自体が外れた
 */
export function outcomeTable(name: string, shots: readonly ShotRecord[]): string {
  const c = countOutcomes(shots);
  const table = markdownTable(
    ['結末', '合体を予測', '予測なし', '合計'],
    SHOT_OUTCOMES.map((o) => [
      OUTCOME_LABELS[o],
      String(c[o].predicted),
      String(c[o].other),
      String(c[o].predicted + c[o].other),
    ]),
  );
  return `### ${name}: 予測 × 結末（${shots.length} 射）\n\n${table}`;
}

/**
 * 「合体を予測したのに合体しなかった」射出の個票（シード→tick 順、最大 count 件）。
 * シードと tick があれば、replayLaunches(seed, ログ, { stopTick: tick }) で
 * 撃つ直前の盤面を再現して目で確かめられる。
 * 着地まで = 撃ってから着地するまでの tick（長いほど予測が崩れる隙が大きい）。
 */
export function missTable(name: string, shots: readonly ShotRecord[], count: number): string {
  const all = mergeMisses(shots).sort((a, b) => a.seed - b.seed || a.tick - b.tick);
  const list = all.slice(0, Math.max(0, count));
  const table = markdownTable(
    ['シード', 'tick', 'Tier', '角度°', '速さ', '予測の相手', '結末', '着地まで', '誤差px'],
    list.map((s) => [
      String(s.seed),
      String(s.tick),
      String(s.tier),
      formatNumber((s.command.originAngleRadians * 180) / Math.PI),
      formatNumber(Math.hypot(s.command.vx, s.command.vy)),
      s.predictedHitBodyId === null ? '—' : String(s.predictedHitBodyId),
      OUTCOME_LABELS[s.outcome],
      s.landTick === null ? '—' : String(s.landTick - s.tick),
      s.landPoint !== null && s.predictedPoint !== null
        ? formatNumber(Math.hypot(s.landPoint.x - s.predictedPoint.x, s.landPoint.y - s.predictedPoint.y))
        : '—',
    ]),
  );
  return `### ${name}: 予測合体の外れ（${all.length} 件中 ${list.length} 件）\n\n${table}`;
}

/** シードごとの一覧を、秒数の短い順に最大 count 行で出す。異常に早く終わるシードを見つける用。 */
export function seedTable(name: string, runs: readonly PlayResult[], count: number): string {
  const sorted = [...runs].sort((a, b) => a.seconds - b.seconds).slice(0, Math.max(0, count));
  const table = markdownTable(
    ['シード', '秒数', '得点', '到達Tier', '合体数', '最大連鎖', '打ち切り'],
    sorted.map((r) => [
      String(r.seed),
      formatNumber(r.seconds),
      formatNumber(r.score),
      formatNumber(r.bestTier),
      formatNumber(r.merges),
      formatNumber(r.maxChain),
      r.timedOut ? 'はい' : '',
    ]),
  );
  return `### ${name}（秒数の短い順）\n\n${table}`;
}
