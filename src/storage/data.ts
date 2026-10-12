import type { RunRecord, SaveDataV1 } from '../contracts/app';
import { TIER_NAMES } from '../game/constants';

export const MAX_RECORDS = 10;
const NAME_LENGTH = 12;
const DEFAULT_VOLUME = 70;
export function playerName(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, NAME_LENGTH) || 'PLAYER' : 'PLAYER';
}
export function defaultSaveData(): SaveDataV1 {
  return { version: 1, playerName: 'PLAYER', bestScore: 0, records: [], lastRecordId: null,
    settings: { sfx: true, volume: DEFAULT_VOLUME, reducedMotion: null, aimGuide: true },
    hints: { firstMergeDone: false, throwShown: false, limitShown: false, chainShown: false } };
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
const number = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
const boolean = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;

export function readRecord(value: unknown): RunRecord | null {
  const item = object(value);
  if (typeof item.id !== 'string' || !item.id || typeof item.playedAt !== 'string' || !Number.isFinite(Date.parse(item.playedAt))
    || typeof item.gameVersion !== 'string') return null;
  const fields = ['score','bestTier','maxChain','seconds','launches','merges','supernovas','seed'] as const;
  if (fields.some(key => typeof item[key] !== 'number' || !Number.isFinite(item[key]) || (item[key] as number) < 0)) return null;
  if (fields.some(key => key !== 'seconds' && !Number.isInteger(item[key])) || (item.bestTier as number) >= TIER_NAMES.length) return null;
  return { id: item.id, name: playerName(item.name), score: item.score as number, bestTier: item.bestTier as number,
    maxChain: item.maxChain as number, seconds: item.seconds as number, launches: item.launches as number,
    merges: item.merges as number, supernovas: item.supernovas as number, seed: item.seed as number,
    playedAt: item.playedAt, gameVersion: item.gameVersion };
}
export function sortRecords(records: readonly RunRecord[]): RunRecord[] {
  return [...records].sort((a,b) => b.score - a.score || Date.parse(a.playedAt) - Date.parse(b.playedAt));
}
export function restoreData(value: unknown): SaveDataV1 {
  const data = object(value);
  const fallback = defaultSaveData();
  if (data.version !== 1) return fallback;
  const settings = object(data.settings);
  const hints = object(data.hints);
  const ids = new Set<string>();
  const records = Array.isArray(data.records) ? data.records.map(readRecord).filter((record): record is RunRecord => {
    if (!record || ids.has(record.id)) return false;
    ids.add(record.id); return true;
  }) : [];
  return {
    version: 1, playerName: playerName(data.playerName),
    bestScore: Math.max(number(data.bestScore), ...records.map(record => record.score)),
    records: sortRecords(records).slice(0, MAX_RECORDS),
    lastRecordId: typeof data.lastRecordId === 'string' ? data.lastRecordId : null,
    settings: { sfx: boolean(settings.sfx, true), volume: Math.min(100, number(settings.volume, DEFAULT_VOLUME)),
      reducedMotion: typeof settings.reducedMotion === 'boolean' ? settings.reducedMotion : null,
      aimGuide: boolean(settings.aimGuide, true) },
    hints: { firstMergeDone: boolean(hints.firstMergeDone, false), throwShown: boolean(hints.throwShown, false),
      limitShown: boolean(hints.limitShown, false), chainShown: boolean(hints.chainShown, false) },
  };
}
