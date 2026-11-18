import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../contracts/app';
import { TIER_COUNT } from '../game/constants';
import { detailFromRecord, migrateStatsArchive, readRunDetail } from './archive';
import { createStatsStore, STATS_BACKUP_KEY, STATS_KEY } from './history';
import { STATS_VERSION, type StoredRunDetail } from './stats';
import { summarizeTrend } from './trend';

const legacy = (day: number): RunRecord => ({
  id: `run-${day}`, name: 'PLAYER', score: 100, bestTier: 2, maxChain: 1,
  seconds: 30, launches: 10, merges: 2, supernovas: 0, seed: 9,
  playedAt: new Date(Date.UTC(2026, 10, day)).toISOString(), gameVersion: '0.1.0',
});
const measured = (day: number, value: number): StoredRunDetail => ({
  ...detailFromRecord(legacy(day)), lands: value, overLimitSeconds: value,
  overLimitEntries: value, maxSingleScore: value, maxImpactSpeed: value,
  mergesByTier: new Array<number>(TIER_COUNT).fill(value),
});

describe('古い記録の不明と実測0', () => {
  it('不明を各指標の分母から外し、実測0と正の数はどちらも残す', () => {
    const runs = [detailFromRecord(legacy(1)), measured(2, 0), measured(3, 6)];
    const trend = summarizeTrend(runs, 3);
    for (const key of ['lands', 'overLimitSeconds', 'overLimitEntries', 'maxSingleScore', 'maxImpactSpeed'] as const) {
      expect(runs[0][key]).toBeNull();
      expect(trend[key]).toMatchObject({ average: 3, best: 6, recentKnownCount: 2, allTimeKnownCount: 2 });
    }
    expect(trend.mergesByTier.every((metric) => metric.average === 3 && metric.recentKnownCount === 2)).toBe(true);
    expect(trend.totalCount).toBe(3);
    expect(trend.score).toMatchObject({ average: 100, recentKnownCount: 3 });
    expect(trend.scorePerLaunch.average).toBe(10);
  });

  it('前の窓が全件不明なら差を出さず、窓外の実測を穴埋めに使わない', () => {
    const runs = [measured(1, 8), detailFromRecord(legacy(2)), measured(3, 0)];
    const trend = summarizeTrend(runs, 1);
    expect(trend.lands).toEqual({ average: 0, best: 0, previousAverage: null, delta: null,
      allTimeBest: 8, recentKnownCount: 1, previousKnownCount: 0, allTimeKnownCount: 2 });
    const unknown = summarizeTrend([runs[1]], 10);
    expect(unknown.lands).toMatchObject({ average: null, best: null, delta: null, allTimeBest: null, allTimeKnownCount: 0 });
    expect(unknown.mergesByTier.every((metric) => metric.average === null && metric.allTimeBest === null)).toBe(true);
  });

  it.each([
    [legacy(1)], { records: [legacy(1)] }, { version: 0, runs: [legacy(1)] },
    { runs: [legacy(1)] }, { version: 1, runs: [legacy(1)] },
    { version: STATS_VERSION, runs: [legacy(1)] },
  ])('旧保存%jを読み、退避・JSON往復・再追加しても不明を保持する', (input) => {
    const raw = JSON.stringify(input);
    const values = new Map([[STATS_KEY, raw]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); } };
    const store = createStatsStore(storage);
    const first = store.load();
    expect(first.version).toBe(STATS_VERSION);
    expect(first.runs[0].lands).toBeNull();
    expect(first.runs[0].mergesByTier).toBeNull();
    expect(values.get(STATS_BACKUP_KEY)).toBe(raw);
    store.addAll(first.runs);
    store.add(measured(2, 0));
    const second = createStatsStore(storage).load();
    expect(second.runs[0]).toEqual(first.runs[0]);
    expect(second.runs[1].lands).toBe(0);
    expect(summarizeTrend(second.runs).lands).toMatchObject({ average: 0, recentKnownCount: 1 });
  });

  it('版1の実測0は、版2へ移しても不明と推測しない', () => {
    const archive = migrateStatsArchive({ version: 1, runs: [measured(1, 0)] });
    expect(archive.version).toBe(STATS_VERSION);
    expect(archive.runs[0].lands).toBe(0);
    expect(summarizeTrend(archive.runs).lands.recentKnownCount).toBe(1);
  });

  it('旧実装の補完0と実測0は同じ形で、出自を推測して書き換えない', () => {
    // 旧detailFromRecordが作った形。出自の印が無く、正当な実測0と区別できない。
    const oldFilled = { ...legacy(1), lands: 0, overLimitSeconds: 0, overLimitEntries: 0,
      scorePerLaunch: 10, maxSingleScore: 0, maxImpactSpeed: 0,
      mergesByTier: new Array<number>(TIER_COUNT).fill(0) };
    const { name: _name, ...oldDetail } = oldFilled;
    expect(oldDetail).toEqual(measured(1, 0));
    const archive = migrateStatsArchive({ version: 1, runs: [oldDetail] });
    expect(archive.runs[0]).toEqual(oldDetail);
    // この行を不明へ戻すには、別の元データが必要。差し戻し10の残りとして記録する。
  });

  it('不明な超過回数を、既知の超過時間から作らない', () => {
    const record = readRunDetail({ ...measured(1, 0), overLimitSeconds: 5, overLimitEntries: null });
    expect(record?.overLimitSeconds).toBe(5);
    expect(record?.overLimitEntries).toBeNull();
  });

  it.each([-1, NaN, Infinity, '0', undefined])('壊れた不明対応項目%jを、不明や実測0として通さない', (value) => {
    expect(readRunDetail({ ...measured(1, 0), lands: value })).toBeNull();
    expect(readRunDetail({ ...measured(1, 0), maxImpactSpeed: value })).toBeNull();
  });
});
