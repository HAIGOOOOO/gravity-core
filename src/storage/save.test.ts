import { describe, expect, it } from 'vitest';
import { BACKUP_KEY, SAVE_KEY, createSaveStore } from './save';
import { defaultSaveData } from './data';
import { createRankingStore } from './ranking';
import type { RunRecord } from '../contracts/app';

function fakeStorage(raw: string | null = null) {
  const values = new Map<string,string>();
  if (raw !== null) values.set(SAVE_KEY, raw);
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string,value: string) => { values.set(key,value); } };
}
function record(id: string, score: number, playedAt = '2026-10-09T00:00:00Z'): RunRecord {
  return { id, score, name: 'PLAYER', bestTier: 3, maxChain: 2, seconds: 60, launches: 10, merges: 5, supernovas: 0,
    seed: 1, playedAt, gameVersion: '0.1.0' };
}
describe('保存データの復旧', () => {
  it('保存が無ければ初期値、再読み込みでは保存値を返す', () => {
    const storage = fakeStorage(); const save = createSaveStore(storage);
    expect(save.load()).toEqual(defaultSaveData());
    const data = save.load(); data.playerName = 'NEBULA'; data.settings.sfx = false; save.save(data);
    expect(createSaveStore(storage).load().playerName).toBe('NEBULA');
    expect(createSaveStore(storage).load().settings.sfx).toBe(false);
  });
  it.each(['{broken', 'null', '[1,2]', '{"version":2}'])('壊れた・違う版の値 %s を退避する', raw => {
    const storage = fakeStorage(raw); expect(createSaveStore(storage).load()).toEqual(defaultSaveData());
    expect(storage.values.get(BACKUP_KEY)).toBe(raw);
  });
  it('欠けた項目を補い、元の文字列も残す', () => {
    const raw = '{"version":1,"playerName":"  STAR  ","settings":{"volume":30}}';
    const storage = fakeStorage(raw); const data = createSaveStore(storage).load();
    expect(data.playerName).toBe('STAR'); expect(data.settings).toEqual({sfx:true,volume:30,reducedMotion:null,aimGuide:true});
    expect(storage.values.get(BACKUP_KEY)).toBe(raw);
  });
  it('不正な型・範囲・記録を画面へ渡さない', () => {
    const raw = { ...defaultSaveData(), bestScore: -1, records: [record('good',100), {...record('bad',20), bestTier: 999}], settings: {sfx:'yes',volume:999} };
    const data = createSaveStore(fakeStorage(JSON.stringify(raw))).load();
    expect(data.records).toHaveLength(1); expect(data.bestScore).toBe(100); expect(data.settings.volume).toBe(100);
  });
  it('読み込み・書き込みが拒否されてもメモリで続け、外部からの変更を隔離する', () => {
    const storage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    const save = createSaveStore(storage); const data = save.load(); data.playerName = 'TEST';
    expect(() => save.save(data)).not.toThrow(); data.playerName = 'MUTATED';
    expect(save.load().playerName).toBe('TEST');
  });
});
describe('端末ランキング', () => {
  it('11件目を順位外にし、ベストと直前のIDを更新する', async () => {
    const save = createSaveStore(null); const ranking = createRankingStore(save);
    for (let i = 1; i <= 10; i++) await ranking.submit(record(String(i),i*100), []);
    expect(await ranking.submit(record('low',1),[])).toEqual({rank:null});
    expect(await ranking.list(20)).toHaveLength(10); expect(save.load().bestScore).toBe(1000); expect(save.load().lastRecordId).toBe('low');
    expect(await ranking.submit(record('high',2000),[])).toEqual({rank:1}); expect(save.load().bestScore).toBe(2000);
  });
  it('同点は日時が早い順、同一IDの再登録は重複させない', async () => {
    const ranking = createRankingStore(createSaveStore(null));
    await ranking.submit(record('late',100,'2026-10-09T01:00:00Z'),[]);
    await ranking.submit(record('early',100),[]); await ranking.submit(record('early',100),[]);
    expect((await ranking.list(10)).map(item=>item.id)).toEqual(['early','late']);
  });
  it('名前を整え、削除後も設定と名前を残す', async () => {
    const save = createSaveStore(null); const ranking = createRankingStore(save);
    await ranking.submit({...record('run',100),name:'  abcdefghijklmn  '},[]);
    expect((await ranking.list(10))[0]?.name).toBe('abcdefghijkl');
    await ranking.rename('run','   '); expect((await ranking.list(10))[0]?.name).toBe('PLAYER');
    await ranking.rename('run','<b>x</b>'); expect((await ranking.list(10))[0]?.name).toBe('<b>x</b>');
    await ranking.clear(); expect(await ranking.list(10)).toEqual([]); expect(save.load().bestScore).toBe(0);
    expect(save.load().settings).toEqual(defaultSaveData().settings);
  });
  it('保存だけ拒否されても追加と改名は成功する', async () => {
    const storage = fakeStorage(); storage.setItem = () => { throw new Error('quota'); };
    const save = createSaveStore(storage); const ranking = createRankingStore(save);
    expect(await ranking.submit(record('one',500),[])).toEqual({rank:1});
    await ranking.rename('one','STAR'); expect((await ranking.list(10))[0]?.name).toBe('STAR');
  });
});
