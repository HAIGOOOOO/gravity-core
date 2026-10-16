// 詳しい統計（RunDetailV1）の置き場所。メインの保存（save.ts）とは別のキーに、版つきで置く。
// 壊れた値・保存できない端末・別の版で落ちない方針は save.ts と同じ。

import type { RunDetailV1, StatsArchive } from './stats';
import { MAX_STATS_RUNS, STATS_VERSION } from './stats';
import { defaultStatsArchive, migrateStatsArchive, readRunDetail } from './archive';
import type { StoragePort } from './save';
import { browserStorage } from './save';

export const STATS_KEY = 'gravity-core:stats:v1';
export const STATS_BACKUP_KEY = 'gravity-core:stats:backup';

export interface StatsStore {
  /** 壊れていても必ず使える値を返す（古い版はここで新しい版へ移す） */
  load(): StatsArchive;
  /** 保存が拒否されても例外を投げない */
  save(archive: StatsArchive): void;
  /** 1 件足す。同じ id は置き換え、古い順に捨てて MAX_STATS_RUNS 件まで残す */
  add(detail: RunDetailV1): void;
  /**
   * まとめて足す（移し替えや一括取り込み用）。add を繰り返すと毎回全件を書き直すので、
   * まとめて入るときはこちらを使う。書き込みは 1 回だけ。
   */
  addAll(details: readonly RunDetailV1[]): void;
  clear(): void;
}

export function createStatsStore(storage: StoragePort | null = browserStorage()): StatsStore {
  let memory = defaultStatsArchive();
  let initialized = false;
  function write(key: string, value: string): void {
    try {
      storage?.setItem(key, value);
    } catch {
      // メモリで続ける。
    }
  }
  function initialize(): void {
    if (initialized) return;
    initialized = true;
    let raw: string | null;
    try {
      raw = storage?.getItem(STATS_KEY) ?? null;
    } catch {
      return;
    }
    if (raw === null) return;
    try {
      const decoded: unknown = JSON.parse(raw);
      memory = migrateStatsArchive(decoded);
      // 移し替えや検査で形が変わったときは、元の値をバックアップへ残してから正規形で書き直す
      if (JSON.stringify(decoded) !== JSON.stringify(memory)) {
        write(STATS_BACKUP_KEY, raw);
        write(STATS_KEY, JSON.stringify(memory));
      }
    } catch {
      write(STATS_BACKUP_KEY, raw);
      write(STATS_KEY, JSON.stringify(memory));
    }
  }
  // 同じ id は新しい方で置き換え、playedAt の古い順に並べて件数を制限する。
  // add も addAll もこの 1 本に通す（1 回の呼び出し = 1 回の書き込み）。
  function addAll(details: readonly RunDetailV1[]): void {
    initialize();
    if (!Array.isArray(details)) return; // 配列でない呼び出しでは落ちない
    const byId = new Map<string, RunDetailV1>();
    for (const run of memory.runs) byId.set(run.id, run);
    for (const item of details) {
      const clean = readRunDetail(item);
      if (clean) byId.set(clean.id, clean);
    }
    const runs = [...byId.values()];
    runs.sort((a, b) => Date.parse(a.playedAt) - Date.parse(b.playedAt));
    memory = { version: STATS_VERSION, runs: runs.slice(-MAX_STATS_RUNS) };
    write(STATS_KEY, JSON.stringify(memory));
  }
  return {
    load() {
      initialize();
      return structuredClone(memory);
    },
    save(archive) {
      initialize();
      memory = migrateStatsArchive(archive);
      write(STATS_KEY, JSON.stringify(memory));
    },
    add(detail) {
      addAll([detail]);
    },
    addAll,
    clear() {
      initialize();
      memory = defaultStatsArchive();
      write(STATS_KEY, JSON.stringify(memory));
    },
  };
}
