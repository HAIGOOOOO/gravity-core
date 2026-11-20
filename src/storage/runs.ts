// 履歴・詳しい統計・再生の共通保存。共有文字列は再生から作り、重複して持たない。
import type { RunRecord } from '../contracts/app';
import { TICK_HZ } from '../game/constants';
import { parseReplay, serializeReplay, type ReplayRecord } from '../replay/record';
import { encodeReplayShare } from '../share/verify';
import { detailFromRecord, migrateStatsArchive, readRunDetail } from './archive';
import { readRecord } from './data';
import { STATS_KEY } from './history';
import { browserStorage, SAVE_KEY, type StoragePort } from './save';
import { MAX_STATS_RUNS, type StoredRunDetail } from './stats';

export const RUN_ARCHIVE_KEY = 'gravity-core:runs:v1';
export const RUN_ARCHIVE_BACKUP_KEY = 'gravity-core:runs:backup';
export const MAX_SAVED_REPLAYS = 100;
// UTF-16なら約3MB。旧保存などと併存するので、保存拒否も呼出元へ返す。
export const MAX_RUN_ARCHIVE_CHARS = 1_500_000;
const MAX_READ_CHARS = 4_000_000;
const VERSION = 1;

export type SavedRunEntry = Readonly<{
  id: string;
  /** 旧統計だけが残っている時は、名前を推測しない。 */
  record: RunRecord | null;
  detail: StoredRunDetail;
  /** serializeReplayの可逆圧縮。古い履歴には再生が無い場合がある。 */
  replay: string | null;
  sample: boolean;
}>;
export type RunArchive = Readonly<{ version: 1; runs: SavedRunEntry[] }>;
export type RunBundle = Readonly<{
  record: RunRecord; detail: StoredRunDetail; replay: ReplayRecord; sample?: boolean;
}>;
export type SaveRunResult = { ok: true; persisted: boolean }
  | { ok: false; reason: 'invalid' | 'mismatch' | 'tooLarge' };
export interface RunStore {
  load(): RunArchive;
  get(id: string): SavedRunEntry | null;
  replay(id: string): ReplayRecord | null;
  share(id: string): string;
  add(bundle: RunBundle): SaveRunResult;
}

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const empty = (): RunArchive => ({ version: VERSION, runs: [] });
const bounded = (v: { id: string; playedAt: string; gameVersion: string }): boolean =>
  v.id.length <= 256 && v.playedAt.length <= 64 && v.gameVersion.length <= 100;
const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
function matchesDetail(record: RunRecord, detail: StoredRunDetail): boolean {
  return record.id === detail.id && record.seed === detail.seed && record.score === detail.score
    && close(record.seconds, detail.seconds) && record.playedAt === detail.playedAt
    && record.gameVersion === detail.gameVersion && record.bestTier === detail.bestTier
    && record.launches === detail.launches && record.merges === detail.merges
    && record.supernovas === detail.supernovas && record.maxChain === detail.maxChain;
}
function matchesReplay(detail: StoredRunDetail, replay: ReplayRecord): boolean {
  return detail.seed === replay.seed && detail.score === replay.finalScore
    && close(detail.seconds, replay.endTick / TICK_HZ)
    && detail.launches === replay.stats.launches && detail.merges === replay.stats.merges
    && detail.supernovas === replay.stats.supernovas && detail.maxChain === replay.stats.maxChain;
}
function readEntry(value: unknown): SavedRunEntry | null {
  if (!object(value)) return null;
  const detail = readRunDetail(value.detail);
  if (!detail || !bounded(detail) || value.id !== detail.id) return null;
  const record = value.record === null ? null : readRecord(value.record);
  if (value.record !== null && (!record || !bounded(record) || !matchesDetail(record, detail))) return null;
  // 壊れた再生だけを外し、元の履歴と不明項目は残す。
  const replay = typeof value.replay === 'string' ? parseReplay(value.replay) : null;
  return { id: detail.id, record, detail,
    replay: replay && matchesReplay(detail, replay) ? serializeReplay(replay) || null : null,
    sample: value.sample === true };
}

function normalize(values: readonly SavedRunEntry[]): RunArchive {
  const ids = new Map(values.map(run => [run.id, run]));
  const runs = [...ids.values()].sort((a, b) => Date.parse(a.detail.playedAt) - Date.parse(b.detail.playedAt)
    || a.id.localeCompare(b.id)).slice(-MAX_STATS_RUNS);
  const result = runs.map(run => ({ ...run, replay: null as string | null }));
  // JSON全体を再生1件ごとに作り直さず、追加する文字列の正確な差分で予算を測る。
  let chars = JSON.stringify({ version: VERSION, runs: result }).length;
  let count = 0;
  for (let i = runs.length - 1; i >= 0; i--) {
    const replay = runs[i].replay;
    if (!replay || count >= MAX_SAVED_REPLAYS) continue;
    const extra = JSON.stringify(replay).length - 4; // nullの4文字との差
    if (chars + extra > MAX_RUN_ARCHIVE_CHARS) continue;
    result[i].replay = replay; chars += extra; count++;
  }
  return { version: VERSION, runs: result };
}

/** 旧キーは消さない。IDが無い旧再生は、似た得点の履歴へ推測で結び付けない。 */
function legacyRuns(read: (key: string) => string | null): RunArchive {
  const decode = (key: string): unknown => {
    try { const raw = read(key); return raw && raw.length <= MAX_READ_CHARS ? JSON.parse(raw) as unknown : null; }
    catch { return null; }
  };
  const details = migrateStatsArchive(decode(STATS_KEY)).runs;
  const entries = new Map<string, SavedRunEntry>();
  for (const detail of details) if (bounded(detail)) entries.set(detail.id, { id: detail.id, record: null, detail, replay: null, sample: false });
  const saved = decode(SAVE_KEY);
  if (object(saved) && saved.version === 1 && Array.isArray(saved.records)) {
    for (const value of saved.records) {
      const record = readRecord(value);
      if (!record || !bounded(record)) continue;
      const prior = entries.get(record.id);
      if (!prior) entries.set(record.id, { id: record.id, record, detail: detailFromRecord(record), replay: null, sample: false });
      else if (matchesDetail(record, prior.detail)) entries.set(record.id, { ...prior, record });
      // 同じIDでも数字が食い違う旧情報を、同じ内容だった事にしない。原本は旧キーに残る。
    }
  }
  return normalize([...entries.values()]);
}

export function createRunStore(storage: StoragePort | null = browserStorage()): RunStore {
  let memory = empty(), initialized = false, readFailed = false, futureVersion = false;
  let pendingBackup: string | null = null;
  const read = (key: string): string | null => { try { return storage?.getItem(key) ?? null; } catch { readFailed = true; return null; } };
  const write = (key: string, value: string): boolean => { try { if (!storage) return false; storage.setItem(key, value); return true; } catch { return false; } };
  function initialize(): void {
    if (initialized) return;
    initialized = true;
    const raw = read(RUN_ARCHIVE_KEY);
    if (raw === null) { memory = legacyRuns(read); return; }
    let decoded: unknown;
    try { if (raw.length > MAX_READ_CHARS) throw new Error('large'); decoded = JSON.parse(raw) as unknown; }
    catch { pendingBackup = raw; return; }
    if (object(decoded) && typeof decoded.version === 'number' && decoded.version > VERSION) { futureVersion = true; return; }
    if (!object(decoded) || decoded.version !== VERSION || !Array.isArray(decoded.runs)) { pendingBackup = raw; return; }
    const entries = decoded.runs.map(readEntry).filter((entry): entry is SavedRunEntry => entry !== null);
    memory = normalize(entries);
    if (JSON.stringify(memory) !== raw) pendingBackup = raw;
  }
  function replay(id: string): ReplayRecord | null {
    initialize(); const text = memory.runs.find(run => run.id === id)?.replay;
    return text ? parseReplay(text) : null;
  }
  return {
    load() { initialize(); return structuredClone(memory); },
    get(id) { initialize(); return structuredClone(memory.runs.find(run => run.id === id) ?? null); },
    replay,
    share(id) { const source = replay(id); return source ? encodeReplayShare(source) : ''; },
    add(bundle) {
      initialize();
      if (futureVersion || !object(bundle)) return { ok: false, reason: 'invalid' };
      let source: ReplayRecord | null;
      try { source = parseReplay(JSON.stringify(bundle.replay)); } catch { source = null; }
      const record = readRecord(bundle.record), detail = readRunDetail(bundle.detail);
      if (!record || !detail || !bounded(record) || !bounded(detail) || !source
        || (bundle.sample !== undefined && typeof bundle.sample !== 'boolean')) return { ok: false, reason: 'invalid' };
      if (!matchesDetail(record, detail) || !matchesReplay(detail, source)) return { ok: false, reason: 'mismatch' };
      const text = serializeReplay(source);
      if (!text) return { ok: false, reason: 'invalid' };
      const entry: SavedRunEntry = { id: record.id, record, detail, replay: text, sample: bundle.sample === true };
      const next = normalize([...memory.runs, entry]);
      const saved = next.runs.find(run => run.id === entry.id);
      if (!saved?.replay) return { ok: false, reason: 'tooLarge' };
      const raw = JSON.stringify(next);
      if (raw.length > MAX_RUN_ARCHIVE_CHARS) return { ok: false, reason: 'tooLarge' };
      memory = next;
      // 表示・読み込みだけでは書かない。原本を読めなかった時も上書きしない。
      let safe = !readFailed;
      if (safe && pendingBackup !== null) {
        safe = write(RUN_ARCHIVE_BACKUP_KEY, pendingBackup);
        if (safe) pendingBackup = null;
      }
      return { ok: true, persisted: safe && write(RUN_ARCHIVE_KEY, raw) };
    },
  };
}
