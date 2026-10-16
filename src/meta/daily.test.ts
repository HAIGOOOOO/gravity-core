import { describe, expect, it } from 'vitest';
import {
  createDailyChallenge,
  dailySeed,
  dayNumberOf,
  jstDateKey,
  practiceSeed,
} from './daily';
import type { MetaStorage } from './storage';

const DAY_MS = 86_400_000;
const STORAGE_KEY = 'gravity-core:daily:v1';

/** JST の y-m-d 0:00 に相当する UTC ms。 */
function jstMidnight(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) - 9 * 3_600_000;
}

function memoryStorage(initial?: Record<string, string>): MetaStorage & { values: Map<string, string> } {
  const values = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('日本時間の日付とシード', () => {
  it('日本時間 23:59:59 と 0:00:00 で日付が変わる', () => {
    const before = jstMidnight(2026, 10, 17) - 1; // JST 10-16 23:59:59.999
    const at = jstMidnight(2026, 10, 17); // JST 10-17 00:00:00.000
    expect(jstDateKey(before)).toBe('2026-10-16');
    expect(jstDateKey(at)).toBe('2026-10-17');
    // UTC 側では同じ日でも JST で日が変わるのがポイント
    expect(dayNumberOf('2026-10-17')).toBe(dayNumberOf('2026-10-16')! + 1);
  });

  it('同じ日付なら一日のどの時刻でも同じシード', () => {
    const morning = jstMidnight(2026, 10, 16);
    const noon = morning + 12 * 3_600_000;
    const night = jstMidnight(2026, 10, 17) - 1;
    const key = '2026-10-16';
    expect(jstDateKey(morning)).toBe(key);
    expect(jstDateKey(noon)).toBe(key);
    expect(jstDateKey(night)).toBe(key);
    expect(dailySeed(jstDateKey(noon))).toBe(dailySeed(key));
    expect(dailySeed(jstDateKey(night))).toBe(dailySeed(key));
  });

  it('365 日ぶんでシードの重なりが無い', () => {
    const keys = new Set<string>();
    const seeds = new Set<number>();
    for (let i = 0; i < 365; i++) {
      const key = jstDateKey(jstMidnight(2027, 1, 1) + i * DAY_MS);
      keys.add(key);
      seeds.add(dailySeed(key));
    }
    expect(keys.size).toBe(365);
    expect(seeds.size).toBe(365);
  });

  it('練習のシードは本番とも、前の練習とも違う', () => {
    const key = '2026-10-16';
    const official = dailySeed(key);
    expect(practiceSeed(key, 0)).not.toBe(official);
    expect(practiceSeed(key, 0)).not.toBe(practiceSeed(key, 1));
    expect(practiceSeed(key, 0)).toBe(practiceSeed(key, 0));
  });
});

describe('本番と練習の区別', () => {
  const t = jstMidnight(2026, 10, 16) + 12 * 3_600_000; // JST 10-16 昼

  it('本番は 1 日 1 回。済ませると練習だけになる', () => {
    const daily = createDailyChallenge(memoryStorage());
    expect(daily.info(t).officialDone).toBe(false);
    const run = daily.beginOfficial(t);
    expect(run).not.toBeNull();
    expect(run!.mode).toBe('official');
    expect(run!.dateKey).toBe('2026-10-16');
    expect(run!.seed).toBe(dailySeed('2026-10-16'));

    expect(daily.completeOfficial(run!, { score: 1200, endedAtMs: t + 600_000 })).toBe(true);
    // 同じランの二度記録も、その日の再本番も不可
    expect(daily.completeOfficial(run!, { score: 9, endedAtMs: t })).toBe(false);
    expect(daily.info(t).officialDone).toBe(true);
    expect(daily.beginOfficial(t)).toBeNull();
    expect(daily.begin(t).mode).toBe('practice');
    expect(daily.history()).toHaveLength(1);
    expect(daily.history()[0]).toMatchObject({ dateKey: '2026-10-16', score: 1200 });
  });

  it('日付が変わる瞬間をまたいでも、開始時の日付に記録される', () => {
    const daily = createDailyChallenge(memoryStorage());
    const before = jstMidnight(2026, 10, 17) - 60_000; // JST 10-16 23:59
    const after = jstMidnight(2026, 10, 17) + 300_000; // JST 10-17 00:05
    const run = daily.beginOfficial(before)!;
    expect(run.dateKey).toBe('2026-10-16');
    expect(daily.completeOfficial(run, { score: 500, endedAtMs: after })).toBe(true);
    // 記録は開始日（10-16）へ。新しい日の本番はまだ未消化
    expect(daily.info(after).dateKey).toBe('2026-10-17');
    expect(daily.info(after).officialDone).toBe(false);
    expect(daily.history().map(r => r.dateKey)).toEqual(['2026-10-16']);
    // そのまま翌日の本番を始められる
    expect(daily.beginOfficial(after)!.dateKey).toBe('2026-10-17');
  });

  it('本番を連続して済ませた日数（streak）を返す', () => {
    const daily = createDailyChallenge(memoryStorage());
    for (let i = 0; i < 3; i++) {
      const ti = jstMidnight(2026, 10, 16) + i * DAY_MS + 3_600_000;
      expect(daily.completeOfficial(daily.beginOfficial(ti)!, { score: 100, endedAtMs: ti })).toBe(true);
    }
    const day4 = jstMidnight(2026, 10, 19) + 3_600_000;
    // 4 日目はまだだが、昨日までの連続は生きている
    expect(daily.info(day4).streak).toBe(3);
    expect(daily.info(day4).officialDone).toBe(false);
    // 1 日空けると streak は切れる
    const day6 = jstMidnight(2026, 10, 21) + 3_600_000;
    expect(daily.info(day6).streak).toBe(0);
  });

  it('記録は保存され、別の実例でも見える', () => {
    const storage = memoryStorage();
    const daily = createDailyChallenge(storage);
    daily.completeOfficial(daily.beginOfficial(t)!, { score: 777, endedAtMs: t });
    const again = createDailyChallenge(storage);
    expect(again.info(t).officialDone).toBe(true);
    expect(again.history()[0]!.score).toBe(777);
  });

  it('練習は記録にもシードにも影響しない', () => {
    const storage = memoryStorage();
    const daily = createDailyChallenge(storage);
    daily.beginPractice(t);
    daily.beginPractice(t);
    expect(daily.info(t).officialDone).toBe(false);
    expect(storage.values.size).toBe(0); // 練習だけでは書き込まない
  });
});

describe('壊れた保存・保存できない端末', () => {
  const t = jstMidnight(2026, 10, 16) + 12 * 3_600_000;

  it.each([
    '{oops',
    'null',
    '[1,2]',
    '"str"',
    '{"version":7,"official":{"2026-01-01":{"score":1,"playedAtMs":1}}}',
    '{"version":1,"official":{"bad-key":{"score":1,"playedAtMs":1}}}',
    '{"version":1,"official":{"2026-10-16":{"score":"x","playedAtMs":1}}}',
    '{"version":1,"official":{"2026-10-16":{"score":-5,"playedAtMs":1}}}',
  ])('中身が %s でも落ちずに初期状態で動く', raw => {
    const daily = createDailyChallenge(memoryStorage({ [STORAGE_KEY]: raw }));
    expect(daily.info(t).officialDone).toBe(false);
    expect(daily.history()).toHaveLength(0);
    expect(daily.beginOfficial(t)).not.toBeNull();
  });

  it('保存の口が無くてもメモリで動く', () => {
    const daily = createDailyChallenge(null);
    const run = daily.beginOfficial(t)!;
    expect(daily.completeOfficial(run, { score: 1, endedAtMs: t })).toBe(true);
    expect(daily.info(t).officialDone).toBe(true);
  });

  it('読み書きが拒否されてもメモリで続ける', () => {
    const daily = createDailyChallenge({
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    });
    const run = daily.beginOfficial(t)!;
    expect(() => daily.completeOfficial(run, { score: 1, endedAtMs: t })).not.toThrow();
    expect(daily.info(t).officialDone).toBe(true);
  });
});
