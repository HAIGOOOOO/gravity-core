// 同じoriginの別タブも、1つのreadwrite transactionで読込・更新する。
export type RunDatabaseSnapshot = Readonly<{ current: unknown; backup: unknown }>;
export type RunDatabaseChange<T> = Readonly<{ result: T; write?: string; currentIsValid?: boolean }>;
const STORE = 'archives';
const CURRENT = 'current', BACKUP = 'backup', CORRUPT = 'corrupt';
export const RUN_DATABASE_OPEN_TIMEOUT_MS = 3000;
export class RunDatabaseOpenError extends Error {
  constructor(cause: unknown) { super('database open unavailable', { cause }); this.name = 'RunDatabaseOpenError'; }
}
export const isRunDatabaseOpenError = (error: unknown): error is RunDatabaseOpenError => error instanceof RunDatabaseOpenError;

export function createRunDatabase(name: string) {
  let opening: Promise<IDBDatabase> | null = null;
  function open(): Promise<IDBDatabase> {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      let settled = false;
      const fail = (cause: unknown) => {
        if (settled) return;
        settled = true; clearTimeout(timer); reject(new RunDatabaseOpenError(cause));
      };
      const timer = setTimeout(() => fail(new Error('database open timeout')), RUN_DATABASE_OPEN_TIMEOUT_MS);
      let request: IDBOpenDBRequest;
      try { request = indexedDB.open(name); } catch (error) { fail(error); return; }
      request.onupgradeneeded = () => {
        if (settled) { try { request.transaction?.abort(); } catch { /* 時間切れ後は作らない。 */ } return; }
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onerror = () => fail(request.error ?? new Error('database unavailable'));
      request.onblocked = () => fail(new Error('database blocked'));
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        settled = true; clearTimeout(timer);
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
    });
    const attempt = opening;
    void attempt.catch(() => { if (opening === attempt) opening = null; });
    return attempt;
  }
  async function transaction<T>(mode: IDBTransactionMode,
    transform: (value: RunDatabaseSnapshot) => RunDatabaseChange<T>): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const current = store.get(CURRENT), backup = store.get(BACKUP);
      let remaining = 2, change: RunDatabaseChange<T>;
      const receive = () => {
        if (--remaining) return;
        try {
          change = transform({ current: current.result as unknown, backup: backup.result as unknown });
          if (change.write !== undefined) {
            if (current.result !== undefined) store.put(current.result as unknown, change.currentIsValid ? BACKUP : CORRUPT);
            store.put(change.write, CURRENT);
          }
        } catch (error) { try { tx.abort(); } catch { /* 既に中断していても元の失敗を返す。 */ } reject(error); }
      };
      current.onsuccess = receive; backup.onsuccess = receive;
      tx.oncomplete = () => resolve(change.result);
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('transaction failed'));
    });
  }
  return {
    read: () => transaction('readonly', value => ({ result: value })),
    update: <T>(transform: (value: RunDatabaseSnapshot) => RunDatabaseChange<T>) => transaction('readwrite', transform),
  };
}
