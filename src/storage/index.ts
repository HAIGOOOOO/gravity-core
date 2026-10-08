// 【仮実装】担当 D が SPEC.md 10.1〜10.3 のとおりに作る。
// いまはメモリの中だけに持ち、ページを閉じると消える。関数名と引数は変えないこと。

import type { RankingStore, RunRecord, SaveDataV1, SaveStore } from '../contracts/app';

export function defaultSaveData(): SaveDataV1 {
  return {
    version: 1,
    playerName: 'PLAYER',
    bestScore: 0,
    records: [],
    lastRecordId: null,
    settings: { sfx: true, volume: 70, reducedMotion: null, timeMarkers: true },
    hints: {
      firstMergeDone: false,
      previewNoteShown: 0,
      tooFastShown: 0,
      coreFallShown: false,
      chainShown: false,
    },
  };
}

export function createSaveStore(): SaveStore {
  let data = defaultSaveData();
  return {
    load: () => structuredClone(data),
    save: (next) => {
      data = structuredClone(next);
    },
  };
}

/**
 * 記録の窓口。初期版は端末内保存（SaveStore の records）だけを扱う。
 * @param save 記録の置き場
 */
export function createRankingStore(save: SaveStore): RankingStore {
  const sorted = (records: RunRecord[]) =>
    [...records].sort((a, b) => b.score - a.score || a.playedAt.localeCompare(b.playedAt));

  return {
    async list(limit) {
      return sorted(save.load().records).slice(0, limit);
    },
    async submit(record) {
      const data = save.load();
      data.records = sorted([...data.records, record]).slice(0, 10);
      data.lastRecordId = record.id;
      data.bestScore = Math.max(data.bestScore, record.score);
      save.save(data);
      const index = data.records.findIndex((r) => r.id === record.id);
      return { rank: index >= 0 ? index + 1 : null };
    },
    async rename(recordId, name) {
      const data = save.load();
      const record = data.records.find((r) => r.id === recordId);
      if (record) record.name = name;
      save.save(data);
    },
    async clear() {
      const data = save.load();
      data.records = [];
      data.bestScore = 0;
      data.lastRecordId = null;
      save.save(data);
    },
  };
}
