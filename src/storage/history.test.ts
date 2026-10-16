import { describe, expect, it } from 'vitest';
import { TIER_COUNT } from '../game/constants';
import { STATS_BACKUP_KEY, STATS_KEY, createStatsStore } from './history';
import { MAX_STATS_RUNS, STATS_VERSION } from './stats';
import { defaultStatsArchive } from './archive';
import { summarizeTrend } from './trend';
import { createRunRecorder } from './recorder';
import type { RunDetailV1, StatsArchive } from './stats';
import type { GameSnapshot } from '../contracts/game';
import type { RunRecord } from '../contracts/app';

function fakeStorage(raw: string | null = null) {
  const values = new Map<string, string>();
  if (raw !== null) values.set(STATS_KEY, raw);
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
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
function legacyRecord(id: string, playedAt: string): RunRecord {
  return {
    id, name: 'PLAYER', score: 100, bestTier: 2, maxChain: 1, seconds: 30,
    launches: 5, merges: 2, supernovas: 0, seed: 9, playedAt, gameVersion: '0.1.0',
  };
}

describe('統計アーカイブの保存', () => {
  it('保存が無ければ初期値、足した記録は再読み込みで残る', () => {
    const storage = fakeStorage();
    const store = createStatsStore(storage);
    expect(store.load()).toEqual(defaultStatsArchive());
    store.add(detail('a', '2026-10-10T00:00:00.000Z'));
    store.add(detail('b', '2026-10-11T00:00:00.000Z'));
    const reloaded = createStatsStore(storage).load();
    expect(reloaded.version).toBe(STATS_VERSION);
    expect(reloaded.runs.map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('playedAt の古い順に並べ、同じ id は置き換える', () => {
    const store = createStatsStore(fakeStorage());
    store.add(detail('new', '2026-10-12T00:00:00.000Z'));
    store.add(detail('old', '2026-10-10T00:00:00.000Z'));
    store.add(detail('new', '2026-10-12T00:00:00.000Z', { score: 999 }));
    const runs = store.load().runs;
    expect(runs.map((r) => r.id)).toEqual(['old', 'new']);
    expect(runs[1]?.score).toBe(999);
  });
  it('形の違う統計は足さない', () => {
    const store = createStatsStore(fakeStorage());
    store.add({ id: 'broken' } as unknown as RunDetailV1);
    expect(store.load().runs).toHaveLength(0);
  });
  it('件数は MAX_STATS_RUNS まで、古い順に捨てる', () => {
    const store = createStatsStore(fakeStorage());
    for (let i = 0; i < MAX_STATS_RUNS + 5; i++) {
      store.add(detail(`r${i}`, new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString()));
    }
    const runs = store.load().runs;
    expect(runs).toHaveLength(MAX_STATS_RUNS);
    expect(runs[0]?.id).toBe('r5');
    expect(runs[MAX_STATS_RUNS - 1]?.id).toBe(`r${MAX_STATS_RUNS + 4}`);
  });
  it('clear で空にする', () => {
    const store = createStatsStore(fakeStorage());
    store.add(detail('a', '2026-10-10T00:00:00.000Z'));
    store.clear();
    expect(store.load().runs).toHaveLength(0);
  });
  it('蓄積器で作った統計をそのまま足し、推移の計算に載る', () => {
    const store = createStatsStore(fakeStorage());
    const recorder = createRunRecorder();
    recorder.feed([
      { sequence: 1, tick: 1, kind: 'launch' },
      { sequence: 2, tick: 40, kind: 'merge', sourceTier: 0, chain: 2, scoreDelta: 100 },
      { sequence: 3, tick: 60, kind: 'gameOver' },
    ]);
    const snap: GameSnapshot = {
      tick: 60, phase: 'over', bodies: [], heat: 0, overLimit: false,
      score: 100, bestTierThisRun: 1, nextQueue: [0, 0, 0],
      launchCooldownLeftSeconds: 0, seed: 7,
      stats: { launches: 1, merges: 1, supernovas: 0, maxChain: 2 },
    };
    store.add(recorder.finish(snap, { id: 'rec-1', playedAt: '2026-10-10T00:00:00.000Z', gameVersion: '0.1.0' }));
    const archive = store.load();
    expect(archive.runs.map((r) => r.id)).toEqual(['rec-1']);
    expect(archive.runs[0]?.mergesByTier[0]).toBe(1);
    const trend = summarizeTrend(archive.runs, 10);
    expect(trend.totalCount).toBe(1);
    expect(trend.score.allTimeBest).toBe(100);
  });
  it('load の戻り値を書き換えても、保存の中身は変わらない', () => {
    const store = createStatsStore(fakeStorage());
    store.add(detail('a', '2026-10-10T00:00:00.000Z'));
    const loaded = store.load();
    loaded.runs.push(detail('fake', '2026-10-11T00:00:00.000Z'));
    (loaded.runs[0] as { score: number }).score = 999999;
    (loaded.runs[0].mergesByTier as number[])[0] = 99;
    const again = store.load();
    expect(again.runs).toHaveLength(1);
    expect(again.runs[0]?.score).toBe(100);
    expect(again.runs[0]?.mergesByTier[0]).toBe(0);
  });
  it('save も移し替えを通して、壊れた項目を捨ててから書く', () => {
    const store = createStatsStore(fakeStorage());
    store.save({
      version: 1,
      runs: [detail('ok', '2026-10-10T00:00:00.000Z'), { id: 'bad' } as unknown as RunDetailV1],
    });
    expect(store.load().runs.map((r) => r.id)).toEqual(['ok']);
  });
  it('mergesByTier の形が違う記録は足さない', () => {
    const store = createStatsStore(fakeStorage());
    store.add(detail('bad', '2026-10-10T00:00:00.000Z', { mergesByTier: [1, 2, 3] }));
    expect(store.load().runs).toHaveLength(0);
  });
  it('読み込み・書き込みが拒否されてもメモリで続ける', () => {
    const storage = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    };
    const store = createStatsStore(storage);
    store.add(detail('a', '2026-10-10T00:00:00.000Z'));
    expect(store.load().runs.map((r) => r.id)).toEqual(['a']);
    expect(() => store.clear()).not.toThrow();
  });
  it('addAll でまとめて足す: 同じ id は新しい方、書き込みは 1 回だけ', () => {
    const storage = fakeStorage();
    const originalSet = storage.setItem;
    let writes = 0;
    storage.setItem = (key, value) => {
      writes++;
      originalSet(key, value);
    };
    const store = createStatsStore(storage);
    store.add(detail('keep', '2026-10-10T00:00:00.000Z'));
    writes = 0;
    store.addAll([
      detail('b', '2026-10-12T00:00:00.000Z'),
      detail('a', '2026-10-11T00:00:00.000Z'),
      detail('keep', '2026-10-13T00:00:00.000Z', { score: 999 }), // 既存 id は置き換え
      { id: 'broken' } as unknown as RunDetailV1, // 形の違う物は捨てる
    ]);
    expect(writes).toBe(1);
    const runs = store.load().runs;
    expect(runs.map((r) => r.id)).toEqual(['a', 'b', 'keep']); // playedAt の古い順
    expect(runs[2]?.score).toBe(999);
  });
  it('addAll でも件数の上限は守られる（1100 件 → 1000 件、1 回の書き込み）', () => {
    const storage = fakeStorage();
    const originalSet = storage.setItem;
    let writes = 0;
    storage.setItem = (key, value) => {
      writes++;
      originalSet(key, value);
    };
    const store = createStatsStore(storage);
    store.addAll(
      Array.from({ length: MAX_STATS_RUNS + 100 }, (_, i) =>
        detail(`r${i}`, new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString())),
    );
    expect(writes).toBe(1);
    const runs = store.load().runs;
    expect(runs).toHaveLength(MAX_STATS_RUNS);
    expect(runs[0]?.id).toBe('r100'); // 一番古い 100 件が捨てられる
  });
  it('保存の受け口が無い端末（null）でも、メモリで続ける', () => {
    const store = createStatsStore(null);
    store.add(detail('a', '2026-10-10T00:00:00.000Z'));
    expect(store.load().runs.map((r) => r.id)).toEqual(['a']);
    expect(() => store.clear()).not.toThrow();
  });
  it('正規形の保存値は、読み込みで書き直さない（退避もしない）', () => {
    const storage = fakeStorage();
    createStatsStore(storage).addAll([detail('a', '2026-10-10T00:00:00.000Z')]);
    let writes = 0;
    const original = storage.setItem;
    storage.setItem = (key, value) => {
      writes++;
      original(key, value);
    };
    const loaded = createStatsStore(storage).load();
    expect(loaded.runs).toHaveLength(1);
    expect(writes).toBe(0);
    expect(storage.values.has(STATS_BACKUP_KEY)).toBe(false);
  });
  it('add は 1 回の呼び出しで 1 回だけ書き込む（呼び出しごと）', () => {
    const storage = fakeStorage();
    let writes = 0;
    const original = storage.setItem;
    storage.setItem = (key, value) => {
      writes++;
      original(key, value);
    };
    const store = createStatsStore(storage);
    store.add(detail('a', '2026-10-10T00:00:00.000Z'));
    store.add(detail('b', '2026-10-11T00:00:00.000Z'));
    expect(writes).toBe(2);
    expect(store.load().runs).toHaveLength(2);
  });
  it('addAll に配列でない物、save に別の版の形を渡しても落ちない', () => {
    const store = createStatsStore(fakeStorage());
    expect(() => store.addAll(null as unknown as RunDetailV1[])).not.toThrow();
    expect(() => store.addAll(42 as unknown as RunDetailV1[])).not.toThrow();
    store.save({ version: 99, runs: [{ id: 'x' }] } as unknown as StatsArchive);
    expect(store.load()).toEqual(defaultStatsArchive());
  });
});

describe('統計アーカイブの移し替え', () => {
  it('壊れた保存値は退避して初期値にする', () => {
    const storage = fakeStorage('{broken');
    const store = createStatsStore(storage);
    expect(store.load()).toEqual(defaultStatsArchive());
    expect(storage.values.get(STATS_BACKUP_KEY)).toBe('{broken');
    expect(JSON.parse(storage.values.get(STATS_KEY)!)).toEqual(JSON.parse(JSON.stringify(defaultStatsArchive())));
  });
  it('旧 RunRecord の列を版 1 へ移し、元の値を退避して書き直す', () => {
    const raw = JSON.stringify({ version: 0, runs: [legacyRecord('old-1', '2026-10-10T00:00:00.000Z')] });
    const storage = fakeStorage(raw);
    const archive = createStatsStore(storage).load();
    expect(archive.version).toBe(STATS_VERSION);
    expect(archive.runs[0]?.id).toBe('old-1');
    expect(archive.runs[0]?.scorePerLaunch).toBeCloseTo(20, 10);
    expect(storage.values.get(STATS_BACKUP_KEY)).toBe(raw);
    const written = JSON.parse(storage.values.get(STATS_KEY)!) as { version: number; runs: { id: string }[] };
    expect(written.version).toBe(STATS_VERSION);
    expect(written.runs.map((r) => r.id)).toEqual(['old-1']);
  });
  it('移せない版の値は捨てて初期値にする', () => {
    const storage = fakeStorage(JSON.stringify({ version: 2, runs: [{ id: 'x' }] }));
    expect(createStatsStore(storage).load()).toEqual(defaultStatsArchive());
  });
});

describe('速度', () => {
  it('1000 件の読み込みと移り変わりの計算が 50ms 以内', () => {
    const storage = fakeStorage();
    const runs = Array.from({ length: 1000 }, (_, i) =>
      detail(`r${i}`, new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString(), { score: i * 10 }),
    );
    storage.setItem(STATS_KEY, JSON.stringify({ version: 1, runs }));
    const store = createStatsStore(storage);
    const t0 = performance.now();
    const archive = store.load();
    const trend = summarizeTrend(archive.runs, 50);
    const elapsed = performance.now() - t0;
    expect(archive.runs).toHaveLength(1000);
    expect(trend.recentCount).toBe(50);
    expect(elapsed).toBeLessThan(50);
  });
  it('1000 件の保存値は 1MB 未満に収まる（localStorage の上限 5MB に対し十分小さい）', () => {
    const storage = fakeStorage();
    createStatsStore(storage).addAll(
      Array.from({ length: 1000 }, (_, i) =>
        detail(`r${i}`, new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString(), {
          mergesByTier: [i % 5, i % 3, 1, 0, 0, 1, 0, 0, 0],
        })),
    );
    const bytes = (storage.values.get(STATS_KEY) ?? '').length;
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(1024 * 1024);
  });
});
