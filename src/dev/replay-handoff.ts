import { parseReplay, serializeReplay, type ReplayRecord } from '../replay/record';
const KEY = 'gravity-core.replay-demo.handoff';

/** ページをまたいだデータは、保存値と同じく読み直して検証する。 */
export function saveReplayHandoff(record: ReplayRecord): boolean {
  const text = serializeReplay(record);
  if (!text) return false;
  try { localStorage.setItem(KEY, text); return true; } catch { return false; }
}
export function readReplayHandoff(): { record: ReplayRecord; tick: number } | null {
  if (new URLSearchParams(location.search).get('from') !== 'result') return null;
  try {
    const record = parseReplay(localStorage.getItem(KEY) ?? '');
    if (!record) return null;
    const value = Number(new URLSearchParams(location.search).get('tick') ?? 0);
    return { record, tick: Number.isFinite(value) ? Math.max(0, Math.min(record.endTick, Math.floor(value))) : 0 };
  } catch { return null; }
}
