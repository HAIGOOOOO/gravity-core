import type { RankingStore, SaveStore } from '../contracts/app';
import { MAX_RECORDS, playerName, readRecord, sortRecords } from './data';

export function createRankingStore(save: SaveStore): RankingStore {
  return {
    async list(limit) { return sortRecords(save.load().records).slice(0, Math.max(0, Math.floor(limit))); },
    async submit(record) {
      const valid = readRecord(record);
      if (!valid) return { rank: null };
      const data = save.load();
      // 同じプレイの二重保存でランキングを埋めない。
      data.records = sortRecords([...data.records.filter(item => item.id !== valid.id), valid]).slice(0, MAX_RECORDS);
      data.lastRecordId = valid.id;
      data.bestScore = Math.max(data.bestScore, valid.score);
      save.save(data);
      const index = data.records.findIndex(item => item.id === valid.id);
      return { rank: index < 0 ? null : index + 1 };
    },
    async rename(id, name) {
      const data = save.load();
      const record = data.records.find(item => item.id === id);
      if (record) record.name = playerName(name);
      save.save(data);
    },
    async clear() {
      const data = save.load();
      data.records = []; data.bestScore = 0; data.lastRecordId = null;
      save.save(data);
    },
  };
}
