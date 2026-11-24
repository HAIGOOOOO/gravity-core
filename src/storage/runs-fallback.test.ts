import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunRecord } from '../contracts/app';
import { createSimulation } from '../game/simulation';
import { aimVelocity } from '../shared/launch';
import { createReplayRecord, serializeReplay } from '../replay/record';
import { createRunRecorder } from './recorder';
import { createSaveStore, SAVE_KEY } from './save';
import { RUN_JOURNAL_PREFIX } from './run-journal';
import { defaultSaveData } from './data';
import { createRunStore, RUN_ARCHIVE_KEY } from './runs';
import type { RunDatabaseChange, RunDatabaseSnapshot } from './run-database';

const mock = vi.hoisted(() => ({ mode: 'success', current: undefined as unknown }));
vi.mock('./run-database', async importOriginal => {
  const actual = await importOriginal<typeof import('./run-database')>();
  return { ...actual, createRunDatabase: () => ({
    async read() {
      if (mock.mode === 'open') throw new actual.RunDatabaseOpenError('open unavailable');
      return { current: mock.current, backup: undefined };
    },
    async update<T>(transform: (snapshot: RunDatabaseSnapshot) => RunDatabaseChange<T>): Promise<T> {
      if (mock.mode === 'open') throw new actual.RunDatabaseOpenError('open unavailable');
      if (mock.mode === 'transaction') throw new Error('put failed');
      const change = transform({ current: mock.current, backup: undefined });
      if (change.write !== undefined) mock.current = change.write;
      return change.result;
    },
  }) };
});
function fixture() {
  const sim = createSimulation(7); const recorder = createRunRecorder(); const angle = -Math.PI / 2;
  sim.submitLaunch({ originAngleRadians: angle, ...aimVelocity(angle, 0, 0) });
  for (let tick = 0; tick < 180; tick++) recorder.feed(sim.stepFixed());
  const final = sim.getSnapshot();
  const detail = recorder.finish(final, { id: 'fallback-run', playedAt: '2026-11-24T00:00:00.000Z', gameVersion: '0.1.0' });
  const record: RunRecord = { id: detail.id, name: 'PLAYER', playedAt: detail.playedAt, gameVersion: detail.gameVersion,
    seed: detail.seed, score: detail.score, bestTier: detail.bestTier, seconds: detail.seconds,
    launches: detail.launches, merges: detail.merges, supernovas: detail.supernovas, maxChain: detail.maxChain };
  return { record, detail, replay: createReplayRecord(sim), final };
}
const bundle = fixture();
function quotaStorage() {
  const values = new Map<string, string>(); const maxBytes = 5 * 1024 * 1024;
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem(key: string, value: string) {
      const next = new Map(values); next.set(key, value);
      const bytes = [...next].reduce((sum, [k, v]) => sum + 2 * (k.length + v.length), 0);
      if (bytes > maxBytes) throw new Error('QuotaExceededError');
      values.set(key, value);
    }, maxBytes };
}
beforeEach(() => { mock.mode = 'success'; mock.current = undefined; vi.stubGlobal('indexedDB', {}); });
afterEach(() => vi.unstubAllGlobals());
describe('DBのopen失敗だけ端末保存へ切り替える', () => {
  it('読めないjournal原文は正常DB保存が成功しても削除しない', async () => {
    const disk = quotaStorage(); const key = RUN_JOURNAL_PREFIX + 'unreadable-nonce';
    const raw = JSON.stringify({ order: 1, value: { broken: true } }); disk.values.set(key, raw);
    const store = createRunStore(disk, { databaseName: 'keep-unreadable',
      localKeys: () => [...disk.values.keys()], removeLocalKey: key => { disk.values.delete(key); } });
    await store.ready();
    expect(await store.add(bundle)).toEqual({ ok: true, persisted: true });
    expect(disk.values.get(key)).toBe(raw);
    expect(JSON.parse(String(mock.current)).runs).toHaveLength(1);
  });

  it('DB既存Aとopen失敗中のBを復旧時に統合し、次のC保存でDBへまとめる', async () => {
    const disk = quotaStorage();
    const named = (id: string) => ({ ...bundle, record: { ...bundle.record, id }, detail: { ...bundle.detail, id } });
    const a = named('A'), b = named('B'), c = named('C');
    const initial = createRunStore(disk, { databaseName: 'recover' });
    await initial.ready(); expect(await initial.add(a)).toEqual({ ok: true, persisted: true });
    const masterA = mock.current;
    mock.mode = 'open';
    const fallback = createRunStore(disk, { databaseName: 'recover' });
    await fallback.ready(); expect(await fallback.add(b)).toEqual({ ok: true, persisted: true });
    expect(mock.current).toBe(masterA);
    mock.mode = 'success';
    const restored = createRunStore(disk, { databaseName: 'recover' }); await restored.ready();
    expect(restored.load().runs.map(row => row.id).sort()).toEqual(['A', 'B']);
    expect(await restored.add(c)).toEqual({ ok: true, persisted: true });
    expect(JSON.parse(String(mock.current)).runs.map((row: { id: string }) => row.id).sort()).toEqual(['A', 'B', 'C']);
  });
  it('列挙可能portの同時fallback追記を両方残し、DB保存成功後だけjournalを消す', async () => {
    const disk = quotaStorage();
    const prior = JSON.stringify({ version: 1, runs: [] }); disk.values.set(RUN_ARCHIVE_KEY, prior);
    disk.values.set('unrelated-old-key', 'keep');
    const options = { databaseName: 'journal-recover', localKeys: () => [...disk.values.keys()],
      removeLocalKey: (key: string) => { disk.values.delete(key); } };
    const named = (id: string) => ({ ...bundle, record: { ...bundle.record, id }, detail: { ...bundle.detail, id } });
    mock.mode = 'open'; const first = createRunStore(disk, options), second = createRunStore(disk, options);
    await Promise.all([first.ready(), second.ready()]); first.load(); second.load();
    expect(await Promise.all([first.add(named('journal-A')), second.add(named('journal-B'))]))
      .toEqual([{ ok: true, persisted: true }, { ok: true, persisted: true }]);
    expect(disk.values.get(RUN_ARCHIVE_KEY)).toBe(prior);
    const pending = [...disk.values.keys()].filter(key => key.startsWith(RUN_JOURNAL_PREFIX));
    expect(pending).toHaveLength(2);
    const reload = createRunStore(disk, options); await reload.ready();
    expect(reload.load().runs.map(row => row.id).sort()).toEqual(['journal-A', 'journal-B']);
    mock.mode = 'success'; const restored = createRunStore(disk, options); await restored.ready();
    expect(restored.load().runs).toHaveLength(2);
    expect([...disk.values.keys()].filter(key => key.startsWith(RUN_JOURNAL_PREFIX))).toHaveLength(2);
    expect(await restored.add(named('journal-C'))).toEqual({ ok: true, persisted: true });
    expect(JSON.parse(String(mock.current)).runs.map((row: { id: string }) => row.id).sort())
      .toEqual(['journal-A', 'journal-B', 'journal-C']);
    expect([...disk.values.keys()].filter(key => key.startsWith(RUN_JOURNAL_PREFIX))).toEqual([]);
    expect(disk.values.get(RUN_ARCHIVE_KEY)).toBe(prior);
    expect(disk.values.get('unrelated-old-key')).toBe('keep');
  });

  it('open error時はlocalへ保存し、新しいstoreから読み戻せる', async () => {
    mock.mode = 'open'; const disk = quotaStorage();
    const store = createRunStore(disk, { databaseName: 'open-fallback' });
    await store.ready(); expect(await store.add(bundle)).toEqual({ ok: true, persisted: true });
    expect(disk.values.has(RUN_ARCHIVE_KEY)).toBe(true);
    const reloaded = createRunStore(disk, { databaseName: 'open-fallback' });
    await reloaded.ready(); expect(reloaded.replay(bundle.record.id)).toEqual(bundle.replay);
  });
  it('transaction失敗はlocal主キーを書かず、メモリとunsaved状態を残す', async () => {
    mock.mode = 'transaction'; const disk = quotaStorage();
    const store = createRunStore(disk, { databaseName: 'put-failed' }); await store.ready();
    expect(await store.add(bundle)).toEqual({ ok: true, persisted: false });
    expect(store.get(bundle.record.id)?.detail).toEqual(bundle.detail);
    expect(store.status()).toBe('unsaved'); expect(disk.values.has(RUN_ARCHIVE_KEY)).toBe(false);
  });
  it('DB成功時はlocal mirrorを作らず、最高点と設定用の保存容量を残す', async () => {
    const disk = quotaStorage();
    const mirror = JSON.stringify({ version: 1, runs: [{ id: bundle.record.id, record: bundle.record,
      detail: bundle.detail, replay: serializeReplay(bundle.replay), sample: false }] });
    // 旧mirrorがあると空きが8byteになる容量。mirrorが無ければ通常保存が収まる。
    const padding = 'p';
    const paddingChars = Math.floor(disk.maxBytes / 2) - padding.length - RUN_ARCHIVE_KEY.length - mirror.length - 4;
    disk.setItem(padding, 'x'.repeat(paddingChars));
    const store = createRunStore(disk, { databaseName: 'no-mirror' }); await store.ready();
    expect(await store.add(bundle)).toEqual({ ok: true, persisted: true });
    expect(mock.current).toBeDefined(); expect(disk.values.has(RUN_ARCHIVE_KEY)).toBe(false);
    const data = defaultSaveData(); data.bestScore = 98765; data.settings.volume = 23; data.settings.sfx = false;
    createSaveStore(disk).save(data);
    expect(disk.values.has(SAVE_KEY)).toBe(true);
    const reloaded = createSaveStore(disk).load();
    expect(reloaded.bestScore).toBe(98765); expect(reloaded.settings).toMatchObject({ volume: 23, sfx: false });
  });
});
