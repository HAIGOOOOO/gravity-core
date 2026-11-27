import { RUN_ARCHIVE_KEY, createRunStore, type RunStore, type SavedRunEntry } from '../storage';
import { serializeReplay } from '../replay';
import type { RecordSample } from './records.worker';

// 画面案を比べるための複製。端末の通常保存・見本専用保存のどちらにも触れない。
export function historySamples(sample: RecordSample, count = 6): RunStore {
  const text = serializeReplay(sample.record);
  const runs: SavedRunEntry[] = Array.from({ length: count }, (_, index) => {
    const id = `history-preview-${index}`;
    const day = Math.floor(index / 2);
    const playedAt = new Date(Date.UTC(2026, 10, 27 - day, 0, 30 - (index % 2) * 15)).toISOString();
    const detail = { ...sample.detail, id, playedAt };
    const { score, bestTier, maxChain, seconds, launches, merges, supernovas, seed, gameVersion } = detail;
    const missing = index % 3 === 1;
    return { id, record: { id, name: '自動の見本', score, bestTier, maxChain, seconds, launches,
      merges, supernovas, seed, gameVersion, playedAt }, detail, sample: true,
      replay: missing || index >= 150 ? null : text,
      ...(missing ? { replayOmitted: index % 2 ? 'capacity' : 'unavailable' } : {}) };
  });
  const raw = JSON.stringify({ version: 1, runs });
  return createRunStore({ getItem: key => key === RUN_ARCHIVE_KEY ? raw : null,
    setItem() { throw new Error('read-only preview'); } });
}
