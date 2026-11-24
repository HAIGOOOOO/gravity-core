// 履歴・詳しい統計・再生の共通保存。共有文字列は再生から作り、重複して持たない。
import type { RunRecord } from '../contracts/app';
import type { GameSnapshot } from '../contracts/game';
import { TICK_HZ } from '../game/constants';
import { parseReplay, serializeReplay, snapshotHash, type ReplayRecord } from '../replay/record';
import { encodeReplayShare } from '../share/verify';
import { detailFromRecord, migrateStatsArchive, readRunDetail } from './archive';
import { readRecord } from './data';
import { STATS_KEY } from './history';
import { browserStorage, SAVE_KEY, type StoragePort } from './save';
import { MAX_STATS_RUNS, type StoredRunDetail } from './stats';
import { createRunDatabase, isRunDatabaseOpenError, type RunDatabaseSnapshot } from './run-database';
import { createRunJournal, type RunJournalItem } from './run-journal';

export const RUN_ARCHIVE_KEY = 'gravity-core:runs:v1';
export const RUN_ARCHIVE_BACKUP_KEY = 'gravity-core:runs:backup';
export const RUN_ARCHIVE_CORRUPT_KEY = 'gravity-core:runs:corrupt';
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
  record: RunRecord; detail: StoredRunDetail; replay: ReplayRecord; final: GameSnapshot; sample?: boolean;
}>;
export type RunStoreStatus = 'ready' | 'recovered' | 'future' | 'unreadable' | 'unsaved';
export type RunStoreOptions = Readonly<{
  databaseName?: string;
  /** 独自の保存口を使う時は、その口のキーだけを列挙・削除する。 */
  localKeys?: () => readonly string[];
  removeLocalKey?: (key: string) => void;
}>;
export type SaveRunResult = { ok: true; persisted: boolean }
  | { ok: false; reason: 'invalid' | 'mismatch' | 'tooLarge' };
export interface RunStore {
  /** 履歴を表示するたびに待つ。別タブの確定済み保存も読み直す。addも内部で待つ。 */
  ready(): Promise<void>;
  load(): RunArchive;
  get(id: string): SavedRunEntry | null;
  replay(id: string): ReplayRecord | null;
  share(id: string): string;
  status(): RunStoreStatus;
  add(bundle: RunBundle): Promise<SaveRunResult>;
}

// 同一実行元の試験用StoragePortでも書込順を保つ。
let writeQueue: Promise<unknown> = Promise.resolve();

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
    replay: replay && matchesReplay(detail, replay) ? value.replay as string : null,
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

export function createRunStore(storage: StoragePort | null = browserStorage(), options: RunStoreOptions = {}): RunStore {
  let memory = empty(), initialized = false, readFailed = false;
  let state: RunStoreStatus = 'ready';
  let currentRaw: string | null | undefined;
  let localArchive: RunArchive | null = null;
  let pendingBackup: { key: string; raw: string } | null = null;
  const unsaved = new Map<string, SavedRunEntry>();
  let nativeStorage = false;
  try { nativeStorage = typeof window !== 'undefined' && storage === window.localStorage; } catch { /* 拒否時はメモリで続ける。 */ }
  let database = nativeStorage || options.databaseName ? createRunDatabase(options.databaseName ?? 'gravity-core:runs') : null;
  const read = (key: string): string | null => { try { return storage?.getItem(key) ?? null; } catch { readFailed = true; return null; } };
  const write = (key: string, value: string): boolean => { try { if (!storage) return false; storage.setItem(key, value); return true; } catch { return false; } };
  const journalKeys = options.localKeys ?? (nativeStorage ? () => Object.keys(window.localStorage) : null);
  const removeLocalKey = options.removeLocalKey ?? (nativeStorage ? (key: string) => window.localStorage.removeItem(key) : undefined);
  const journal = journalKeys ? createRunJournal({
    keys: () => { try { return journalKeys(); } catch (error) { readFailed = true; throw error; } },
    read, write, remove: removeLocalKey,
  }) : null;
  let pendingItems: RunJournalItem[] = [];
  function journalRuns(): SavedRunEntry[] {
    pendingItems = journal?.read() ?? [];
    return pendingItems.map(item => readEntry(item.value)).filter((entry): entry is SavedRunEntry => entry !== null);
  }
  function decode(raw: string | null): unknown {
    try { return raw && raw.length <= MAX_READ_CHARS ? JSON.parse(raw) as unknown : null; }
    catch { return null; }
  }
  function archive(value: unknown): RunArchive | null {
    if (!object(value) || value.version !== VERSION || !Array.isArray(value.runs)) return null;
    return normalize(value.runs.map(readEntry).filter((entry): entry is SavedRunEntry => entry !== null));
  }
  function refresh(): void {
    initialized = true;
    const raw = read(RUN_ARCHIVE_KEY);
    if (raw !== currentRaw) {
      currentRaw = raw; pendingBackup = null; state = 'ready';
      const decoded = decode(raw);
      if (object(decoded) && typeof decoded.version === 'number' && decoded.version > VERSION) {
        state = 'future'; return;
      }
      const primary = archive(decoded);
      localArchive = primary;
      if (raw === null) memory = empty();
      else if (primary) memory = primary;
      else {
        const recovered = archive(decode(read(RUN_ARCHIVE_BACKUP_KEY)));
        memory = recovered ?? empty();
        state = recovered ? 'recovered' : 'unreadable';
      }
      if (raw !== null && (!primary || JSON.stringify(primary) !== raw)) {
        const backup = archive(decode(read(RUN_ARCHIVE_BACKUP_KEY)));
        pendingBackup = { key: backup ? RUN_ARCHIVE_CORRUPT_KEY : RUN_ARCHIVE_BACKUP_KEY, raw };
      }
    }
    if (state === 'future') return;
    // 本体が旧キーへ書く期間も、新しく増えたIDを見失わない。新形式の同IDが優先。
    memory = normalize([...legacyRuns(read).runs, ...memory.runs, ...journalRuns(), ...unsaved.values()]);
    if (readFailed) state = 'unreadable';
  }
  function initialize(): void { if (!initialized) refresh(); }
  function fromDatabase(snapshot: RunDatabaseSnapshot): boolean {
    const decoded = typeof snapshot.current === 'string' ? decode(snapshot.current) : snapshot.current;
    if (object(decoded) && typeof decoded.version === 'number' && decoded.version > VERSION) { state = 'future'; return false; }
    if (state === 'future') return false;
    const primary = typeof snapshot.current === 'string' && snapshot.current === currentRaw
      ? localArchive : archive(decoded);
    const backup = primary ? null : archive(typeof snapshot.backup === 'string' ? decode(snapshot.backup) : snapshot.backup);
    if (primary || backup) {
      memory = normalize([...legacyRuns(read).runs, ...(localArchive?.runs ?? []), ...(primary ?? backup)!.runs,
        ...journalRuns(), ...unsaved.values()]);
      state = unsaved.size ? 'unsaved' : primary ? 'ready' : 'recovered';
    } else if (snapshot.current !== undefined) state = 'unreadable';
    return Boolean(primary);
  }
  async function ready(): Promise<void> {
    if (!database) { refresh(); return; }
    refresh();
    try { fromDatabase(await database.read()); }
    catch (error) {
      if (isRunDatabaseOpenError(error)) { database = null; refresh(); }
      else state = 'unreadable';
    }
  }
  function mirror(raw: string): boolean {
    if (readFailed) return false;
    if (pendingBackup !== null) {
      if (!write(pendingBackup.key, pendingBackup.raw)) return false;
      pendingBackup = null;
    }
    if (!write(RUN_ARCHIVE_KEY, raw)) return false;
    currentRaw = raw;
    localArchive = memory;
    return true;
  }
  function saveLocal(raw: string, entry: SavedRunEntry): boolean {
    if (!journal) return mirror(raw); // 同一実行元の試験用StoragePort。
    if (readFailed || !journal.append(entry)) return false;
    // 古い履歴の原本とbackupは消さない。追記口だけを保持上限へそろえる。
    const rows = journal.read();
    const readable = rows.map(item => readEntry(item.value)).filter((value): value is SavedRunEntry => value !== null);
    memory = normalize([...memory.runs, ...readable]);
    const latest = new Map<string, RunJournalItem>();
    for (const item of rows) { const value = readEntry(item.value); if (value) latest.set(value.id, item); }
    const retained = new Map(memory.runs.map(value => [value.id, value]));
    journal.retain(rows, value => {
      const clean = readEntry(value);
      if (!clean) return value;
      const target = retained.get(clean.id);
      if (!target) return null;
      return target.replay === null ? { ...clean, replay: null } : clean;
    });
    journal.acknowledge(rows.filter(item => {
      const value = readEntry(item.value); return value && latest.get(value.id)?.key !== item.key;
    }));
    return true;
  }
  function replay(id: string): ReplayRecord | null {
    initialize(); const text = memory.runs.find(run => run.id === id)?.replay;
    return text ? parseReplay(text) : null;
  }
  return {
    ready,
    load() { if (database) initialize(); else refresh(); return structuredClone(memory); },
    get(id) { initialize(); return structuredClone(memory.runs.find(run => run.id === id) ?? null); },
    replay,
    share(id) { const source = replay(id); return source ? encodeReplayShare(source) : ''; },
    status() { initialize(); return state; },
    async add(bundle) {
      let proposed = '', included = new Map<string, SavedRunEntry>();
      const commit = (persist: boolean, refreshFirst: boolean): SaveRunResult => {
        if (refreshFirst) refresh();
        if (state === 'future' || !object(bundle)) return { ok: false, reason: 'invalid' };
        let source: ReplayRecord | null;
        try { source = parseReplay(JSON.stringify(bundle.replay)); } catch { source = null; }
        const record = readRecord(bundle.record), detail = readRunDetail(bundle.detail);
        if (!record || !detail || !bounded(record) || !bounded(detail) || !source
          || !object(bundle.final) || !object(bundle.final.stats)
          || (bundle.sample !== undefined && typeof bundle.sample !== 'boolean')) return { ok: false, reason: 'invalid' };
        if (!matchesDetail(record, detail) || !matchesReplay(detail, source)) return { ok: false, reason: 'mismatch' };
        const final = bundle.final;
        if (snapshotHash(final) !== source.finalHash || final.bestTierThisRun !== detail.bestTier
          || final.bodies.length !== source.finalBodyCount
          || final.seed !== detail.seed || final.score !== detail.score || final.tick !== source.endTick
          || final.phase !== source.phase || final.stats.launches !== detail.launches
          || final.stats.merges !== detail.merges || final.stats.supernovas !== detail.supernovas
          || final.stats.maxChain !== detail.maxChain) return { ok: false, reason: 'mismatch' };
        const text = serializeReplay(source);
        if (!text) return { ok: false, reason: 'invalid' };
        const entry: SavedRunEntry = { id: record.id, record, detail, replay: text, sample: bundle.sample === true };
        const next = normalize([...memory.runs, entry]);
        const saved = next.runs.find(run => run.id === entry.id);
        if (!saved?.replay) return { ok: false, reason: 'tooLarge' };
        const raw = JSON.stringify(next);
        if (raw.length > MAX_RUN_ARCHIVE_CHARS) return { ok: false, reason: 'tooLarge' };
        memory = next;
        unsaved.set(entry.id, entry);
        const retained = new Set(next.runs.map(run => run.id));
        for (const id of unsaved.keys()) if (!retained.has(id)) unsaved.delete(id);
        proposed = raw; included = new Map(unsaved);
        const persisted = persist && saveLocal(raw, saved);
        if (persisted) { unsaved.clear(); state = 'ready'; }
        else if (!readFailed) state = 'unsaved';
        return { ok: true, persisted };
      };
      const guarded = (persist = true, refreshFirst = true): SaveRunResult => {
        try { return commit(persist, refreshFirst); } catch { return { ok: false, reason: 'invalid' }; }
      };
      if (database) {
        let result: SaveRunResult = { ok: false, reason: 'invalid' };
        let imported: RunJournalItem[] = [];
        try {
          result = await database.update(snapshot => {
            refresh();
            const currentIsValid = fromDatabase(snapshot);
            imported = pendingItems.filter(item => readEntry(item.value) !== null);
            result = guarded(false, false);
            return { result, ...(result.ok ? { write: proposed, currentIsValid } : {}) };
          });
          if (result.ok) {
            // 正はDBに確定済み。localStorageへ複製して最高点・設定の空きを奪わない。
            for (const [id, value] of included) if (unsaved.get(id) === value) unsaved.delete(id);
            journal?.acknowledge(imported);
            state = 'ready';
            return { ok: true, persisted: true };
          }
          return result;
        } catch (error) {
          if (isRunDatabaseOpenError(error)) database = null;
          else {
            // 開けたDBのtransaction失敗を、別の保存口で成功扱いにしない。
            const fallback = result.ok ? { ok: true as const, persisted: false } : guarded(false);
            if (fallback.ok && !readFailed) state = 'unsaved';
            return fallback;
          }
        }
      }
      const pending = writeQueue.then(() => guarded(), () => guarded());
      writeQueue = pending;
      return pending;
    },
  };
}
