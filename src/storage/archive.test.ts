import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../contracts/app';
import { TIER_COUNT } from '../game/constants';
import { defaultStatsArchive, detailFromRecord, migrateStatsArchive, readRunDetail } from './archive';
import { MAX_STATS_RUNS, STATS_VERSION } from './stats';
import type { RunDetailV1 } from './stats';

function detail(id: string, playedAt: string, over: Partial<RunDetailV1> = {}): RunDetailV1 {
  return {
    id,
    playedAt,
    seed: 1,
    gameVersion: '0.1.0',
    score: 100,
    seconds: 60,
    launches: 10,
    lands: 9,
    merges: 5,
    supernovas: 0,
    maxChain: 2,
    bestTier: 3,
    overLimitSeconds: 0,
    overLimitEntries: 0,
    scorePerLaunch: 10,
    maxSingleScore: 220,
    maxImpactSpeed: 600,
    mergesByTier: new Array<number>(TIER_COUNT).fill(0),
    ...over,
  };
}
function legacyRecord(id: string, playedAt = '2026-10-10T00:00:00.000Z', over: Partial<RunRecord> = {}): RunRecord {
  return {
    id, name: 'PLAYER', score: 100, bestTier: 2, maxChain: 1, seconds: 30,
    launches: 5, merges: 2, supernovas: 0, seed: 9, playedAt, gameVersion: '0.1.0', ...over,
  };
}

describe('版の移し替え', () => {
  it('裸の RunRecord 列を版 1 の統計へ移す（分からない項目は 0）', () => {
    const archive = migrateStatsArchive([
      legacyRecord('old-a', '2026-10-10T00:00:00.000Z'),
      legacyRecord('old-b', '2026-10-11T00:00:00.000Z', { score: 50, launches: 0 }),
    ]);
    expect(archive.version).toBe(STATS_VERSION);
    expect(archive.runs.map((r) => r.id)).toEqual(['old-a', 'old-b']);
    expect(archive.runs[0]?.maxChain).toBe(1);
    expect(archive.runs[0]?.scorePerLaunch).toBeCloseTo(20, 10);
    expect(archive.runs[0]?.overLimitSeconds).toBe(0);
    expect(archive.runs[0]?.mergesByTier).toHaveLength(TIER_COUNT);
    expect(archive.runs[1]?.scorePerLaunch).toBe(0);
  });
  it('records を持つ形（メインの保存と同じ形）からも移す', () => {
    const archive = migrateStatsArchive({ version: 1, records: [legacyRecord('x')] });
    expect(archive.runs.map((r) => r.id)).toEqual(['x']);
  });
  it('{version:0, runs} の形からも移す', () => {
    const archive = migrateStatsArchive({ version: 0, runs: [legacyRecord('v0')] });
    expect(archive.runs.map((r) => r.id)).toEqual(['v0']);
  });
  it('版 1 の保存は 1 件ずつ検査し、壊れた物だけ捨てる', () => {
    const good = detail('good', '2026-10-10T00:00:00.000Z');
    const archive = migrateStatsArchive({
      version: 1,
      runs: [good, { ...detail('bad', '2026-10-11T00:00:00.000Z'), launches: -3 }, detail('good2', '2026-10-12T00:00:00.000Z')],
    });
    expect(archive.runs.map((r) => r.id)).toEqual(['good', 'good2']);
  });
  it('版 1 の runs に旧 RunRecord が混ざっていても拾う', () => {
    const archive = migrateStatsArchive({ version: 1, runs: [detail('new', '2026-10-11T00:00:00.000Z'), legacyRecord('old', '2026-10-10T00:00:00.000Z')] });
    expect(archive.runs.map((r) => r.id)).toEqual(['old', 'new']);
  });
  it('移した記録はそのまま検査を通る（往復で落ちない）', () => {
    const migrated = detailFromRecord(legacyRecord('rt'));
    expect(readRunDetail(migrated)).not.toBeNull();
    expect(readRunDetail(detail('full', '2026-10-10T00:00:00.000Z'))).not.toBeNull();
  });
  it.each([null, 42, 'broken', '{broken', { version: 2, runs: [] }, { version: 'x' }, [1, 2, 3], { runs: 'no' }])(
    '移せない保存値 %j は捨てて初期値にする',
    (value) => {
      expect(migrateStatsArchive(value)).toEqual(defaultStatsArchive());
    },
  );
  it('id の重複は 1 件にし、playedAt の古い順に並べ、件数を制限する', () => {
    const runs = [
      detail('dup', '2026-10-12T00:00:00.000Z'),
      detail('b', '2026-10-11T00:00:00.000Z'),
      detail('dup', '2026-10-13T00:00:00.000Z'),
      detail('a', '2026-10-10T00:00:00.000Z'),
    ];
    const archive = migrateStatsArchive({ version: 1, runs });
    expect(archive.runs.map((r) => r.id)).toEqual(['a', 'b', 'dup']);
    expect(archive.runs[2]?.playedAt).toBe('2026-10-12T00:00:00.000Z');
    expect(archive.runs.length).toBeLessThanOrEqual(MAX_STATS_RUNS);
  });
});
