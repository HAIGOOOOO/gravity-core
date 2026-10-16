import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../contracts/app';
import type { GameEvent, GameEventKind, GameSnapshot } from '../contracts/game';
import { TICK_HZ, TIER_COUNT } from '../game/constants';
import { createAutoPlay, onCore } from '../fixtures';
import {
  MAX_STATS_RUNS,
  STATS_VERSION,
  buildRunDetail,
  defaultStatsArchive,
  detailFromRecord,
  migrateStatsArchive,
  summarizeTrend,
} from './stats';
import type { RunDetailV1 } from './stats';

const META = { id: 'run-1', playedAt: '2026-10-16T00:00:00.000Z', gameVersion: '0.1.0' } as const;

let sequence = 0;
function event(kind: GameEventKind, tick: number, extra: Partial<GameEvent> = {}): GameEvent {
  return { sequence: sequence++, tick, kind, ...extra };
}
function snapshot(partial: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    tick: 0,
    phase: 'active',
    bodies: [],
    heat: 0,
    overLimit: false,
    score: 0,
    bestTierThisRun: 0,
    nextQueue: [0, 0, 0],
    launchCooldownLeftSeconds: 0,
    seed: 1,
    stats: { launches: 0, merges: 0, supernovas: 0, maxChain: 0 },
    ...partial,
  };
}
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

describe('プレイ統計の作成', () => {
  it('出来事の列から各項目を数え、限界超過は区間の和を取る', () => {
    const events = [
      event('launch', 1),
      event('land', 30, { impactSpeed: 500 }),
      event('launch', 40),
      event('land', 60, { impactSpeed: 700 }),
      event('merge', 61, { sourceTier: 0, resultTier: 1, chain: 1, scoreDelta: 100 }),
      event('merge', 62, { sourceTier: 1, resultTier: 2, chain: 2, scoreDelta: 330 }),
      event('supernova', 70, { sourceTier: 8, chain: 5, scoreDelta: 99999 }),
      event('overLimitStart', 100),
      event('overLimitEnd', 220),
      event('overLimitStart', 300),
      event('gameOver', 400),
    ];
    const snap = snapshot({
      tick: 400, phase: 'over', score: 1234, bestTierThisRun: 5, seed: 42,
      stats: { launches: 2, merges: 2, supernovas: 1, maxChain: 5 },
    });
    const d = buildRunDetail(events, snap, META);
    expect(d.id).toBe('run-1');
    expect(d.seed).toBe(42);
    expect(d.score).toBe(1234);
    expect(d.seconds).toBeCloseTo(400 / TICK_HZ, 10);
    expect(d.launches).toBe(2);
    expect(d.lands).toBe(2);
    expect(d.merges).toBe(2);
    expect(d.supernovas).toBe(1);
    expect(d.maxChain).toBe(5);
    expect(d.bestTier).toBe(5);
    // 越えていたのは tick 100〜220 と 300〜400（終了まで開きっぱなし）
    expect(d.overLimitSeconds).toBeCloseTo(220 / TICK_HZ, 10);
    expect(d.overLimitEntries).toBe(2);
    expect(d.scorePerLaunch).toBeCloseTo(617, 10);
    expect(d.maxSingleScore).toBe(99999);
    expect(d.maxImpactSpeed).toBe(700);
    expect(d.mergesByTier).toHaveLength(TIER_COUNT);
    expect(d.mergesByTier[0]).toBe(1);
    expect(d.mergesByTier[1]).toBe(1);
    // 超新星は合体回数に含めない
    expect(d.mergesByTier[8]).toBe(0);
    expect(d.mergesByTier.reduce((a, b) => a + b, 0)).toBe(2);
  });
  it('出来事に連鎖が無いときは盤面の集計を使う', () => {
    const events = [event('merge', 5, { sourceTier: 0, resultTier: 1, scoreDelta: 100 })];
    const d = buildRunDetail(events, snapshot({ stats: { launches: 0, merges: 1, supernovas: 0, maxChain: 3 } }), META);
    expect(d.maxChain).toBe(3);
  });
  it('1 投も無ければ 1 投あたりの得点は 0', () => {
    const d = buildRunDetail([], snapshot({ score: 500 }), META);
    expect(d.launches).toBe(0);
    expect(d.scorePerLaunch).toBe(0);
  });
  it('overLimitEnd の無いままゲームが続いても、最後の tick まで数える', () => {
    const events = [event('overLimitStart', 10)];
    const d = buildRunDetail(events, snapshot({ tick: 70 }), META);
    expect(d.overLimitSeconds).toBeCloseTo(60 / TICK_HZ, 10);
  });
});

describe('自動プレイとの照合', () => {
  it('自動プレイから作った統計が、出来事の数と盤面の集計に合う', () => {
    // 核の上に並べた Tier 0 2 体が最初の tick で合体する（必ず merge が出る）
    const auto = createAutoPlay(5, { bodies: [onCore(0, -1.6), onCore(0, -1.12)], queue: [0, 1, 2] });
    const events: GameEvent[] = [];
    for (let i = 0; i < 2400 && auto.sim.getSnapshot().phase === 'active'; i++) {
      events.push(...auto.step());
    }
    const snap = auto.sim.getSnapshot();
    const d = buildRunDetail(events, snap, { ...META, id: 'auto' });
    const count = (kind: GameEventKind) => events.filter((e) => e.kind === kind).length;
    expect(d.launches).toBeGreaterThan(0);
    expect(d.merges).toBeGreaterThan(0);
    expect(d.launches).toBe(count('launch'));
    expect(d.lands).toBe(count('land'));
    expect(d.merges).toBe(count('merge'));
    expect(d.supernovas).toBe(count('supernova'));
    expect(d.launches).toBe(snap.stats.launches);
    expect(d.merges).toBe(snap.stats.merges);
    expect(d.supernovas).toBe(snap.stats.supernovas);
    expect(d.maxChain).toBe(snap.stats.maxChain);
    expect(d.score).toBe(snap.score);
    expect(d.seconds).toBeCloseTo(snap.tick / TICK_HZ, 10);
    expect(d.bestTier).toBe(snap.bestTierThisRun);
    expect(d.overLimitSeconds).toBeGreaterThanOrEqual(0);
    expect(d.mergesByTier.reduce((a, b) => a + b, 0)).toBe(d.merges);
  });
});

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

describe('上達の移り変わり', () => {
  const days = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString();
  it('記録が無ければ全て null', () => {
    const trend = summarizeTrend([], 10);
    expect(trend.recentCount).toBe(0);
    expect(trend.score.average).toBeNull();
    expect(trend.score.best).toBeNull();
    expect(trend.score.delta).toBeNull();
  });
  it('窓より少ないときは、前の窓の比較は null', () => {
    const runs = [detail('a', days(0), { score: 100 }), detail('b', days(1), { score: 300 })];
    const trend = summarizeTrend(runs, 10);
    expect(trend.recentCount).toBe(2);
    expect(trend.previousCount).toBe(0);
    expect(trend.score.average).toBeCloseTo(200, 10);
    expect(trend.score.best).toBe(300);
    expect(trend.score.previousAverage).toBeNull();
    expect(trend.score.delta).toBeNull();
  });
  it('直近 N 件とその前の N 件を比べて伸びを出す', () => {
    const runs = [
      ...Array.from({ length: 10 }, (_, i) => detail(`old-${i}`, days(i), { score: 100, maxChain: 1 })),
      ...Array.from({ length: 10 }, (_, i) => detail(`new-${i}`, days(10 + i), { score: 250, maxChain: 3 })),
    ];
    const trend = summarizeTrend(runs, 10);
    expect(trend.recentCount).toBe(10);
    expect(trend.previousCount).toBe(10);
    expect(trend.score.average).toBeCloseTo(250, 10);
    expect(trend.score.previousAverage).toBeCloseTo(100, 10);
    expect(trend.score.delta).toBeCloseTo(150, 10);
    expect(trend.score.best).toBe(250);
    expect(trend.maxChain.delta).toBeCloseTo(2, 10);
  });
  it('窓に満たない分だけ前の窓を使い、入力の順番は問わない', () => {
    const runs = [
      detail('p1', days(0), { score: 10 }),
      detail('p2', days(1), { score: 20 }),
      detail('r1', days(2), { score: 100 }),
      detail('r2', days(3), { score: 200 }),
    ].reverse();
    const trend = summarizeTrend(runs, 2);
    expect(trend.recentCount).toBe(2);
    expect(trend.previousCount).toBe(2);
    expect(trend.score.average).toBeCloseTo(150, 10);
    expect(trend.score.previousAverage).toBeCloseTo(15, 10);
    expect(trend.score.delta).toBeCloseTo(135, 10);
  });
});
