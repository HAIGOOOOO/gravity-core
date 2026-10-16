import { describe, expect, it } from 'vitest';
import {
  createDailyChallenge,
  dailySeed,
  dayNumberOf,
  JST_OFFSET_MS,
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

describe('日付キーの検証', () => {
  it.each([
    '2026-02-30', // 実在しない日
    '2026-13-01', // 13 月
    '2026-00-15', // 0 月
    '2026-10-32', // 32 日
    '2026-02-29', // 平年の 2/29
    'not-a-date',
    '2026-1-1', // ゼロ詰めなしは形から違う
    '',
    ' 2026-10-16',
  ])('dateKey %s は実在しない・形の違う日付として null', key => {
    expect(dayNumberOf(key)).toBeNull();
  });

  it('うるう年の 2/29 は実在する', () => {
    expect(dayNumberOf('2028-02-29')).not.toBeNull();
    expect(dayNumberOf('2028-02-29')).toBe(dayNumberOf('2028-02-28')! + 1);
  });

  it('dailySeed は 32bit の整数を返す', () => {
    for (const key of ['2026-10-16', '1999-12-31', '2100-01-01', '2028-02-29']) {
      const s = dailySeed(key);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2 ** 32);
    }
  });

  it('有限でない時刻が来ても既定の日付に落ち、紀元前でも動く', () => {
    expect(jstDateKey(Number.NaN)).toBe('1970-01-01');
    expect(jstDateKey(Number.POSITIVE_INFINITY)).toBe('1970-01-01');
    // UTC では紀元前でも、JST（+9 時間）では 1970-01-01 の朝
    expect(jstDateKey(-1)).toBe('1970-01-01');
    // JST の 1970-01-01 0 時の 1ms 前から紀元前の日付になる
    expect(jstDateKey(jstMidnight(1970, 1, 1) - 1)).toBe('1969-12-31');
  });

  it('Date の表せる範囲外・西暦 0 未満・1 万年以降も既定の日付に落ちる', () => {
    // この入力では 'YYYY-MM-DD' の形に収まらないため、落とす先を固定しておく
    for (const t of [1e17, -1e17, 8.64e15, -8.64e15]) {
      expect(jstDateKey(t)).toBe('1970-01-01');
    }
  });

  it('出てくる日付キーは常に実在の日付として往復できる', () => {
    const times = [
      0,
      -1,
      jstMidnight(1969, 12, 31),
      jstMidnight(2000, 2, 29), // うるう日
      jstMidnight(2100, 3, 1), // 2100 はうるう年ではない
      jstMidnight(9999, 12, 31),
    ];
    for (const t of times) {
      const key = jstDateKey(t);
      const n = dayNumberOf(key);
      expect(n).not.toBeNull();
      // その日の最初の 1ms（UTC）を JST 日付へ戻すと同じキーになる
      expect(jstDateKey(n! * DAY_MS - JST_OFFSET_MS)).toBe(key);
    }
  });

  it('西暦 3 桁以下の年でも日付キーが往復する', () => {
    // Date.UTC は年 0〜99 を 1900 年代と解釈するので setUTCFullYear で作る
    const d = new Date(Date.UTC(2000, 5, 15));
    d.setUTCFullYear(123); // 123-06-15 00:00 UTC = JST 09:00
    const key = jstDateKey(d.getTime());
    expect(key).toBe('0123-06-15');
    expect(dayNumberOf(key)).not.toBeNull();
  });
});

describe('ランの記録の細部', () => {
  const t = jstMidnight(2026, 10, 16) + 12 * 3_600_000; // JST 10-16 昼

  it('begin() は本番が残っていれば本番、済んでいれば練習を返す', () => {
    const daily = createDailyChallenge(memoryStorage());
    expect(daily.begin(t).mode).toBe('official');
    daily.completeOfficial(daily.beginOfficial(t)!, { score: 1, endedAtMs: t });
    expect(daily.begin(t).mode).toBe('practice');
  });

  it('練習は呼ぶたび次の盤面になる', () => {
    const daily = createDailyChallenge(memoryStorage());
    const a = daily.beginPractice(t);
    const b = daily.beginPractice(t);
    expect(a.mode).toBe('practice');
    expect(b.mode).toBe('practice');
    expect(a.dateKey).toBe(b.dateKey);
    expect(a.seed).not.toBe(b.seed);
  });

  it('練習ランや、形の違う日付のランは記録できない', () => {
    const daily = createDailyChallenge(memoryStorage());
    expect(daily.completeOfficial(daily.beginPractice(t), { score: 1, endedAtMs: t })).toBe(false);
    expect(
      daily.completeOfficial(
        { mode: 'official', dateKey: 'not-a-date', seed: 1 },
        { score: 1, endedAtMs: t },
      ),
    ).toBe(false);
    expect(daily.history()).toHaveLength(0);
  });

  it('スコアは 0 以上の整数に丸め、時刻が変なら 0 で記録する', () => {
    const cases: Array<[number, number]> = [
      [1234.9, 1234],
      [-50, 0],
      [Number.NaN, 0],
    ];
    cases.forEach(([raw, want], i) => {
      const daily = createDailyChallenge(memoryStorage());
      const ti = jstMidnight(2026, 10, 16 + i) + 3_600_000;
      const run = daily.beginOfficial(ti)!;
      expect(daily.completeOfficial(run, { score: raw, endedAtMs: Number.NaN })).toBe(true);
      expect(daily.history()[0]).toMatchObject({ score: want, playedAtMs: 0 });
    });
  });

  it('今日を済ませた日は、その日を含めて連続を数える', () => {
    const daily = createDailyChallenge(memoryStorage());
    daily.completeOfficial(daily.beginOfficial(t)!, { score: 1, endedAtMs: t });
    expect(daily.info(t).streak).toBe(1);
  });

  it('履歴は新しい日付順に並ぶ（記録した順番は関係ない）', () => {
    const daily = createDailyChallenge(memoryStorage());
    for (const i of [2, 0, 1]) {
      const ti = jstMidnight(2026, 10, 16 + i) + 3_600_000;
      daily.completeOfficial(daily.beginOfficial(ti)!, { score: i, endedAtMs: ti });
    }
    expect(daily.history().map(r => r.dateKey)).toEqual([
      '2026-10-18',
      '2026-10-17',
      '2026-10-16',
    ]);
  });

  it('履歴は上限を越えると古い日から捨てる', () => {
    const official: Record<string, { score: number; playedAtMs: number }> = {};
    for (let i = 0; i < 1105; i++) {
      const key = new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
      official[key] = { score: i, playedAtMs: i };
    }
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ version: 1, official }) });
    const daily = createDailyChallenge(storage);
    expect(daily.history()).toHaveLength(1105);
    daily.completeOfficial(daily.beginOfficial(t)!, { score: 1, endedAtMs: t });
    expect(daily.history()).toHaveLength(1100);
    // 新しい記録のぶん、古い 6 日が捨てられる
    expect(daily.history().some(r => r.dateKey === '2020-01-01')).toBe(false);
    expect(daily.history().some(r => r.dateKey === '2020-01-07')).toBe(true);
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
