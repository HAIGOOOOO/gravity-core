import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../contracts/app';
import { createSimulation } from '../game/simulation';
import { aimVelocity } from '../shared/launch';
import { createReplayRecord, serializeReplay } from '../replay/record';
import { shareToReplay } from '../share';
import { createRunRecorder } from './recorder';
import { STATS_KEY } from './history';
import { SAVE_KEY } from './save';
import { defaultSaveData } from './data';
import { MAX_STATS_RUNS } from './stats';
import { createRunStore, RUN_ARCHIVE_KEY, RUN_ARCHIVE_BACKUP_KEY, MAX_SAVED_REPLAYS, MAX_RUN_ARCHIVE_CHARS } from './runs';

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
}
function fixture(id = 'run-1') {
  const sim = createSimulation(7);
  const recorder = createRunRecorder();
  const angle = -Math.PI / 2;
  sim.submitLaunch({ originAngleRadians: angle, ...aimVelocity(angle, 0, 0) });
  for (let tick = 0; tick < 180; tick++) recorder.feed(sim.stepFixed());
  const final = sim.getSnapshot();
  const detail = recorder.finish(final, { id, playedAt: '2026-11-21T00:00:00.000Z', gameVersion: '0.1.0' });
  const record: RunRecord = { id, name: 'PLAYER', playedAt: detail.playedAt, gameVersion: detail.gameVersion,
    seed: detail.seed, score: detail.score, bestTier: detail.bestTier, seconds: detail.seconds,
    launches: detail.launches, merges: detail.merges, supernovas: detail.supernovas, maxChain: detail.maxChain };
  // 保存時刻とプレイ日時は別物なので、意図して異なる日時にする。
  const replay = createReplayRecord(sim, { now: new Date('2026-11-21T01:00:00.000Z') });
  return { record, detail, replay, final };
}
const base = fixture();
function identified(index: number) {
  const id = `run-${index}`;
  const playedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
  return { record: { ...base.record, id, playedAt }, detail: { ...base.detail, id, playedAt }, replay: base.replay };
}

describe('プレイを一つに保存する', () => {
  it('同じidの記録・統計・再生を1キーに保存し、共有は再生から導出する', () => {
    const disk = storage(); const store = createRunStore(disk);
    expect(store.add(base)).toEqual({ ok: true, persisted: true });
    expect([...disk.values.keys()]).toEqual([RUN_ARCHIVE_KEY]);
    const reopened = createRunStore(disk);
    expect(reopened.load().version).toBe(1);
    expect(reopened.get(base.record.id)).toMatchObject({ id: base.record.id, record: base.record, detail: base.detail, sample: false });
    expect(reopened.replay(base.record.id)).toEqual(base.replay);
    const shared = shareToReplay(reopened.share(base.record.id));
    expect(shared.ok).toBe(true);
    if (shared.ok) expect(shared.final).toEqual(base.final);
    expect(disk.values.get(RUN_ARCHIVE_KEY)).not.toContain(reopened.share(base.record.id));
    expect(reopened.get('missing')).toBeNull();
    expect(reopened.replay('missing')).toBeNull();
    expect(reopened.share('missing')).toBe('');
  });
  it('同じidは置き換え、sampleの指定も保持する', () => {
    const store = createRunStore(storage()); store.add(base);
    expect(store.add({ ...base, record: { ...base.record, name: 'RENAMED' }, sample: true }).ok).toBe(true);
    expect(store.load().runs).toHaveLength(1);
    expect(store.get(base.record.id)).toMatchObject({ record: { name: 'RENAMED' }, sample: true });
  });
  it.each(['id', 'seed', 'score', 'seconds', 'launches', 'merges', 'supernovas', 'maxChain'] as const)(
    '%sが食い違う追加を拒否し、直前の保存を維持する', (field) => {
      const disk = storage(); const store = createRunStore(disk); store.add(base);
      const previous = disk.values.get(RUN_ARCHIVE_KEY);
      const changed = field === 'id' ? { ...base.detail, id: 'another' }
        : { ...base.detail, [field]: base.detail[field] + 1 };
      expect(store.add({ ...base, detail: changed })).toEqual({ ok: false, reason: 'mismatch' });
      expect(disk.values.get(RUN_ARCHIVE_KEY)).toBe(previous);
      expect(store.get(base.record.id)?.detail).toEqual(base.detail);
    });
  it('再生側だけのseed・得点・statsの食い違いも拒否する', () => {
    const store = createRunStore(storage()); store.add(base);
    for (const replay of [
      { ...base.replay, seed: base.replay.seed + 1 },
      { ...base.replay, finalScore: base.replay.finalScore + 1 },
      { ...base.replay, stats: { ...base.replay.stats, launches: base.replay.stats.launches + 1 } },
    ]) expect(store.add({ ...base, replay })).toEqual({ ok: false, reason: 'mismatch' });
    expect(store.replay(base.record.id)).toEqual(base.replay);
  });
  it('空idの壊れた記録を拒否する', () => {
    expect(createRunStore(null).add({ ...base, record: { ...base.record, id: '' } })).toEqual({ ok: false, reason: 'invalid' });
  });
  it('履歴1000件を残し、再生は新しい100件だけ保持する', () => {
    const disk = storage();
    const runs = Array.from({ length: MAX_STATS_RUNS }, (_, i) => {
      const item = identified(i);
      return { id: item.record.id, ...item, replay: serializeReplay(item.replay), sample: false };
    });
    disk.values.set(RUN_ARCHIVE_KEY, JSON.stringify({ version: 1, runs }));
    const store = createRunStore(disk);
    expect(store.add(identified(MAX_STATS_RUNS)).ok).toBe(true);
    const rows = store.load().runs;
    expect(rows).toHaveLength(MAX_STATS_RUNS);
    expect(rows.filter(row => row.replay !== null)).toHaveLength(MAX_SAVED_REPLAYS);
    expect(store.get('run-0')).toBeNull();
    expect(store.replay('run-1')).toBeNull();
    expect(store.replay(`run-${MAX_STATS_RUNS}`)).not.toBeNull();
  });
  it.each([1, 2])('旧統計の版%sと旧ランキングを移し、元キーと不明nullを保つ', (version) => {
    const disk = storage();
    disk.values.set(STATS_KEY, JSON.stringify({ version, runs: [base.detail] }));
    const old = { ...base.record, id: 'legacy-only' };
    disk.values.set(SAVE_KEY, JSON.stringify({ ...defaultSaveData(), records: [base.record, old] }));
    const originals = new Map(disk.values);
    const store = createRunStore(disk); const rows = store.load().runs;
    expect(rows).toHaveLength(2);
    expect(store.get(base.record.id)).toMatchObject({ record: base.record, detail: base.detail, replay: null });
    expect(store.get(old.id)?.detail).toMatchObject({ lands: null, maxImpactSpeed: null, mergesByTier: null });
    for (const [key, value] of originals) expect(disk.values.get(key)).toBe(value);
  });
  it('壊れたcanonical JSONを退避して読み込みを継続する', () => {
    const disk = storage(); disk.values.set(RUN_ARCHIVE_KEY, '{broken');
    expect(createRunStore(disk).load().runs).toEqual([]);
    expect(disk.values.get(RUN_ARCHIVE_BACKUP_KEY)).toBe('{broken');
  });
  it('保存拒否時もメモリで続け、persisted:falseを返す', () => {
    const denied = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const store = createRunStore(denied);
    expect(store.add(base)).toEqual({ ok: true, persisted: false });
    expect(store.replay(base.record.id)).toEqual(base.replay);
    expect(store.get(base.record.id)?.detail).toEqual(base.detail);
  });
  it('古いルールの記録を残すが共有文字列は作らない', () => {
    const store = createRunStore(storage());
    const replay = { ...base.replay, rulesVersion: 'r0.00000000' };
    expect(store.add({ ...base, replay }).ok).toBe(true);
    expect(store.replay(base.record.id)).toEqual(replay);
    expect(store.share(base.record.id)).toBe('');
  });
  it('履歴本体だけで容量上限を超える時は追加を拒否し、既存保存を維持する', () => {
    const disk = storage();
    const runs = Array.from({ length: MAX_STATS_RUNS }, (_, i) => {
      const item = identified(i);
      const id = item.record.id.padEnd(256, 'x');
      const gameVersion = 'v'.repeat(100);
      return { id, record: { ...item.record, id, gameVersion }, detail: { ...item.detail, id, gameVersion }, replay: null, sample: false };
    });
    const previous = JSON.stringify({ version: 1, runs });
    expect(previous.length).toBeGreaterThan(MAX_RUN_ARCHIVE_CHARS);
    disk.values.set(RUN_ARCHIVE_KEY, previous);
    const store = createRunStore(disk);
    expect(store.add(identified(MAX_STATS_RUNS))).toEqual({ ok: false, reason: 'tooLarge' });
    expect(disk.values.get(RUN_ARCHIVE_KEY)).toBe(previous);
  });
});
