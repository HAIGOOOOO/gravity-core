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
  it('未検査の古い記録（負・非整数・範囲外）を渡しても、検査を通る統計にそろえる', () => {
    const broken: RunRecord = {
      ...legacyRecord('brk'),
      score: -5,
      seconds: -1,
      launches: -2,
      merges: NaN,
      maxChain: Infinity,
      bestTier: 99,
      seed: 3.7,
    };
    const d = detailFromRecord(broken);
    expect(d.score).toBe(0);
    expect(d.seconds).toBe(0);
    expect(d.launches).toBe(0);
    expect(d.merges).toBe(0);
    expect(d.maxChain).toBe(0);
    expect(d.seed).toBe(3); // 非整数は切り捨て
    expect(d.bestTier).toBe(TIER_COUNT - 1); // 範囲外は上端に丸める
    expect(d.scorePerLaunch).toBe(0);
    expect(readRunDetail(d)).not.toBeNull();
  });
  it.each([null, 42, 'broken', '{broken', { version: 2, runs: [] }, { version: 'x' }, [1, 2, 3], { runs: 'no' }])(
    '移せない保存値 %j は捨てて初期値にする',
    (value) => {
      expect(migrateStatsArchive(value)).toEqual(defaultStatsArchive());
    },
  );
  it('版 1 の記録で mergesByTier が無くても、0 埋めで拾う', () => {
    const without = { ...detail('no-tier', '2026-10-10T00:00:00.000Z'), mergesByTier: undefined };
    const archive = migrateStatsArchive({ version: 1, runs: [without] });
    expect(archive.runs).toHaveLength(1);
    expect(archive.runs[0]?.mergesByTier).toEqual(new Array<number>(TIER_COUNT).fill(0));
  });
  it('detailFromRecord に null を渡しても落ちず、id は空のまま（保存側の検査で捨てられる）', () => {
    const d = detailFromRecord(null as unknown as RunRecord);
    expect(d.id).toBe('');
    expect(d.score).toBe(0);
    expect(readRunDetail(d)).toBeNull();
  });
  it('id の重複は後の物で置き換え（addAll と同じ規則）、playedAt の古い順に並べ、件数を制限する', () => {
    const runs = [
      detail('dup', '2026-10-12T00:00:00.000Z'),
      detail('b', '2026-10-11T00:00:00.000Z'),
      detail('dup', '2026-10-13T00:00:00.000Z', { score: 999 }),
      detail('a', '2026-10-10T00:00:00.000Z'),
    ];
    const archive = migrateStatsArchive({ version: 1, runs });
    expect(archive.runs.map((r) => r.id)).toEqual(['a', 'b', 'dup']);
    expect(archive.runs[2]?.playedAt).toBe('2026-10-13T00:00:00.000Z');
    expect(archive.runs[2]?.score).toBe(999);
    expect(archive.runs.length).toBeLessThanOrEqual(MAX_STATS_RUNS);
  });
  it('限界超過の時間がプレイ時間を越える壊れた記録は、捨てずに関係だけ直す', () => {
    const d = readRunDetail(detail('wide', '2026-10-10T00:00:00.000Z', { seconds: 10, overLimitSeconds: 50 }));
    expect(d).not.toBeNull();
    expect(d?.seconds).toBe(10);
    expect(d?.overLimitSeconds).toBe(10);
  });
});
