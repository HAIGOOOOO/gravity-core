// 統計アーカイブの検査と版の移し替え。
// 壊れた項目は 1 件ずつ捨て、移せない形はまるごと捨てて初期値にする（data.ts / save.ts と同じ方針）。

import type { RunRecord } from '../contracts/app';
import { TIER_COUNT } from '../game/constants';
import { readRecord } from './data';
import type { RunDetailV1, StatsArchive } from './stats';
import { MAX_STATS_RUNS, STATS_VERSION } from './stats';

export function defaultStatsArchive(): StatsArchive {
  return { version: STATS_VERSION, runs: [] };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const nonNegativeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const nonNegativeInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** mergesByTier は書き忘れに耐える（無ければ 0 埋め）。あるのに形が違う物は捨てる。 */
function readMergesByTier(value: unknown): number[] | null {
  if (value === undefined) return new Array<number>(TIER_COUNT).fill(0);
  if (!Array.isArray(value) || value.length !== TIER_COUNT || !value.every(nonNegativeInt)) return null;
  return [...value] as number[];
}

/** 壊れた項目を渡さないための検査（data.ts の readRecord と同じ方針）。 */
export function readRunDetail(value: unknown): RunDetailV1 | null {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || !value.id) return null;
  if (typeof value.playedAt !== 'string' || !Number.isFinite(Date.parse(value.playedAt))) return null;
  if (typeof value.gameVersion !== 'string') return null;
  const ints = ['score', 'seed', 'launches', 'lands', 'merges', 'supernovas', 'maxChain', 'bestTier', 'overLimitEntries', 'maxSingleScore'] as const;
  if (ints.some((key) => !nonNegativeInt(value[key]))) return null;
  const reals = ['seconds', 'overLimitSeconds', 'scorePerLaunch', 'maxImpactSpeed'] as const;
  if (reals.some((key) => !nonNegativeNumber(value[key]))) return null;
  if ((value.bestTier as number) >= TIER_COUNT) return null;
  const mergesByTier = readMergesByTier(value.mergesByTier);
  if (mergesByTier === null) return null;
  return {
    id: value.id,
    playedAt: value.playedAt,
    seed: value.seed as number,
    gameVersion: value.gameVersion,
    score: value.score as number,
    seconds: value.seconds as number,
    launches: value.launches as number,
    lands: value.lands as number,
    merges: value.merges as number,
    supernovas: value.supernovas as number,
    maxChain: value.maxChain as number,
    bestTier: value.bestTier as number,
    // 作り側は「限界超過 ≤ プレイ時間」を保証する。それを越える保存値は壊れているので、
    // 項目を捨てずに関係だけ直す（1 回分まるごと落とすほどの壊れではない）
    overLimitSeconds: Math.min(value.seconds as number, value.overLimitSeconds as number),
    overLimitEntries: value.overLimitEntries as number,
    scorePerLaunch: value.scorePerLaunch as number,
    maxSingleScore: value.maxSingleScore as number,
    maxImpactSpeed: value.maxImpactSpeed as number,
    mergesByTier,
  };
}

const saneReal = (value: unknown): number =>
  (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
const saneInt = (value: unknown): number => Math.floor(saneReal(value));

/**
 * 古い形（得点順の 1 行だけの RunRecord）を版 1 の統計に移す。元の記録に無い項目は 0。
 * 移し替え（readRecord 経由）では値は検査済みだが、未検査の記録・null を直接渡されても
 * 検査落ちしないよう、数値はここで正規形にそろえる。id と日時は捏造しない（読めなければ
 * そのまま渡して保存時の検査に落としてもらう）。
 */
export function detailFromRecord(record: RunRecord): RunDetailV1 {
  const src: Partial<RunRecord> = record ?? {};
  const score = saneInt(src.score);
  const launches = saneInt(src.launches);
  return {
    id: typeof src.id === 'string' ? src.id : '',
    playedAt: typeof src.playedAt === 'string' ? src.playedAt : '',
    seed: saneInt(src.seed),
    gameVersion: typeof src.gameVersion === 'string' ? src.gameVersion : '',
    score,
    seconds: saneReal(src.seconds),
    launches,
    lands: 0,
    merges: saneInt(src.merges),
    supernovas: saneInt(src.supernovas),
    maxChain: saneInt(src.maxChain),
    bestTier: Math.min(TIER_COUNT - 1, saneInt(src.bestTier)),
    overLimitSeconds: 0,
    overLimitEntries: 0,
    scorePerLaunch: launches > 0 ? score / launches : 0,
    maxSingleScore: 0,
    maxImpactSpeed: 0,
    mergesByTier: new Array<number>(TIER_COUNT).fill(0),
  };
}

/** RunRecord の形の列を、版 1 の統計に移す（読めない項目は捨てる）。 */
function migrateLegacyRuns(list: readonly unknown[]): RunDetailV1[] {
  const runs: RunDetailV1[] = [];
  for (const item of list) {
    const record = readRecord(item);
    if (record) runs.push(detailFromRecord(record));
  }
  return runs;
}

/**
 * id の重複は後の物で置き換え、playedAt の古い順に並べて件数を制限する。
 * 移し替えでも history.ts の addAll でもこの 1 本に通し、同じ入力には同じ結果になるようにする。
 */
export function normalizeRuns(runs: readonly RunDetailV1[]): RunDetailV1[] {
  const byId = new Map<string, RunDetailV1>();
  for (const run of runs) byId.set(run.id, run);
  const unique = [...byId.values()];
  unique.sort((a, b) => Date.parse(a.playedAt) - Date.parse(b.playedAt));
  return unique.slice(-MAX_STATS_RUNS);
}

/**
 * 保存値（JSON.parse 済みの unknown）を版 1 のアーカイブに移す。
 * - `{version:1, runs}` …… いまの形。1 件ずつ検査し、壊れた物だけ捨てる。
 *   runs の中に旧 RunRecord が混ざっていても拾えるだけ拾う。
 * - `records` を持つ物・裸の配列・`{version:0, runs}` …… 旧 RunRecord の列として移す。
 * - それ以外（未来の版・壊れた物）は移せないので捨てて初期値。
 */
export function migrateStatsArchive(value: unknown): StatsArchive {
  let runs: RunDetailV1[] | null = null;
  if (isObject(value) && value.version === STATS_VERSION && Array.isArray(value.runs)) {
    runs = [];
    for (const item of value.runs) {
      const detail = readRunDetail(item);
      if (detail) runs.push(detail);
      else {
        const record = readRecord(item);
        if (record) runs.push(detailFromRecord(record));
      }
    }
  } else {
    const legacyList = Array.isArray(value)
      ? value
      : isObject(value) && Array.isArray(value.records)
        ? value.records
        : isObject(value) && (value.version === undefined || value.version === 0) && Array.isArray(value.runs)
          ? value.runs
          : null;
    if (legacyList !== null) runs = migrateLegacyRuns(legacyList);
    else if (isObject(value) && value.version === STATS_VERSION) runs = [];
  }
  if (runs === null) return defaultStatsArchive();
  return { version: STATS_VERSION, runs: normalizeRuns(runs) };
}
