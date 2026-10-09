import type { SaveDataV1, SaveStore } from '../contracts/app';
import { defaultSaveData, restoreData } from './data';

export const SAVE_KEY = 'gravity-core:v1';
export const BACKUP_KEY = 'gravity-core:backup';
export type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
function browserStorage(): StoragePort | null {
  // localStorage の取得そのものが拒否される環境もある。
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}
export function createSaveStore(storage: StoragePort | null = browserStorage()): SaveStore {
  let memory = defaultSaveData();
  let initialized = false;
  function write(key: string, value: string): void { try { storage?.setItem(key, value); } catch { /* メモリで続ける。 */ } }
  function initialize(): void {
    if (initialized) return;
    initialized = true;
    let raw: string | null;
    try { raw = storage?.getItem(SAVE_KEY) ?? null; } catch { return; }
    if (raw === null) return;
    try {
      const decoded: unknown = JSON.parse(raw);
      memory = restoreData(decoded);
      if (JSON.stringify(decoded) !== JSON.stringify(memory)) { write(BACKUP_KEY, raw); write(SAVE_KEY, JSON.stringify(memory)); }
    } catch { write(BACKUP_KEY, raw); write(SAVE_KEY, JSON.stringify(memory)); }
  }
  return {
    load() { initialize(); return structuredClone(memory); },
    save(data: SaveDataV1) {
      initialize();
      memory = restoreData(data);
      write(SAVE_KEY, JSON.stringify(memory));
    },
  };
}
