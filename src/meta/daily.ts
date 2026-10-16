// 日替わり勝負。日本時間（JST = UTC+9、夏時間なし）の日付から、その日のシードを作る。
// 見るのは呼び出し側が渡した時刻だけなので、端末のタイムゾーンや時計のずれに左右されない。
// ずるの余地（端末の時計そのものをずらす等）は docs/notes/B/swe-meta.md に記録してある。

import { asObject, readStoredJson, writeStoredJson, type MetaStorage } from './storage';

/** 日本時間（UTC+9、夏時間なし）のオフセット。時刻で判定する meta の各部品で共有する */
export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const STORAGE_KEY = 'gravity-core:daily:v1';
/** 本番の履歴は約 3 年ぶんだけ残し、古い物から捨てる */
const HISTORY_CAP = 1100;

export type DailyMode = 'official' | 'practice';

/** 1 回のプレイに結びついた日替わり情報。開始時に決まり、日付をまたいでも変わらない */
export type DailyRun = Readonly<{
  mode: DailyMode;
  /** 'YYYY-MM-DD'（JST） */
  dateKey: string;
  seed: number;
}>;

export type DailyInfo = Readonly<{
  dateKey: string;
  /** 今日の本番のシード */
  seed: number;
  /** 今日の本番を済ませたか */
  officialDone: boolean;
  /** 本番を連続して済ませた日数。今日まだでも、昨日まで続いていればその数 */
  streak: number;
}>;

export type DailyRecord = Readonly<{
  dateKey: string;
  score: number;
  /** 記録した実時刻（ms） */
  playedAtMs: number;
}>;

/** 本番ランの結果。時刻は呼び出し側が渡す */
export type DailyResult = Readonly<{
  score: number;
  endedAtMs: number;
}>;

export interface DailyChallenge {
  /** その時刻での今日の情報 */
  info(nowMs: number): DailyInfo;
  /** その時刻で本番を始める。今日済ませていれば null */
  beginOfficial(nowMs: number): DailyRun | null;
  /**
   * 練習を始める。呼ぶたびに次の盤面になる。
   * 本番と同じ盤面で練習すると先読みできてしまうので、シードは別系列にする。
   */
  beginPractice(nowMs: number): DailyRun;
  /** 本番が残っていれば本番、なければ練習を返す */
  begin(nowMs: number): DailyRun;
  /** 本番ランの結果を記録する。日付をまたいでも、ラン開始時の日付に記録される。2 度記録しない */
  completeOfficial(run: DailyRun, result: DailyResult): boolean;
  /** 本番の履歴（新しい日付順） */
  history(): readonly DailyRecord[];
}

/**
 * 渡された時刻（UTC ms）を日本時間の日付キー 'YYYY-MM-DD' にする。
 * 年は 4 桁にゼロ詰めする。Date が表せない時刻・西暦 0 未満・1 万年以降は
 * キーの形に収まらないので既定の日付へ落とす（出力は必ず dayNumberOf を通る形）。
 */
export function jstDateKey(nowMs: number): string {
  const ms = Number.isFinite(nowMs) ? nowMs : 0;
  const d = new Date(ms + JST_OFFSET_MS);
  const year = d.getUTCFullYear(); // Invalid Date では NaN
  if (!Number.isFinite(year) || year < 0 || year > 9999) return '1970-01-01';
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${month}-${day}`;
}

/**
 * 日付キーを 1970-01-01 からの日数へ。形・日付の違う文字列には null。
 * Date.UTC は 13 月や 2/30 を翌月へ丸めるので、往復させて実在の日だけ通す
 * （丸めたまま通すと、違う日付キーが同じ日数＝同じシードへ化けてしまう）。
 * さらに Date.UTC は年 0〜99 を 1900 年代と解釈するので、うるう年の 2000 年で
 * いったん日付を作ってから目的の年へ移し、西暦 3 桁以下の年も正しく検証する。
 */
export function dayNumberOf(dateKey: string): number | null {
  const m = DATE_KEY_PATTERN.exec(dateKey);
  if (!m) return null;
  const y = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(2000, month - 1, day));
  d.setUTCFullYear(y);
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return Math.floor(d.getTime() / DAY_MS);
}

/**
 * 整数を 32bit へ散らす。奇数の掛け算と XOR シフトはどちらも逆写像を持つので、
 * この関数全体が全単射になる＝違う日付は必ず違うシードになる。
 */
function mix32(n: number): number {
  let h = Math.imul(n + 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** 本番のシード。同じ日付ならどの端末でも同じ。 */
export function dailySeed(dateKey: string): number {
  return mix32(dayNumberOf(dateKey) ?? 0);
}

/** 練習のシード。本番とは別の系列にし、呼ぶたび進む attempt で盤面を変える。 */
export function practiceSeed(dateKey: string, attempt: number): number {
  const n = dayNumberOf(dateKey) ?? 0;
  return mix32(Math.imul(n, 4_000_003) + Math.imul((attempt | 0) + 1, 7919) + 1);
}

type DayRecord = { score: number; playedAtMs: number };
type DailySave = { version: 1; official: Record<string, DayRecord> };

/** 壊れた・古い形の保存を捨て、使える分だけ復元する。 */
function restoreSave(value: unknown): DailySave {
  const official: Record<string, DayRecord> = {};
  const data = asObject(value);
  if (data.version === 1) {
    for (const [key, raw] of Object.entries(asObject(data.official))) {
      if (dayNumberOf(key) === null) continue;
      const item = asObject(raw);
      const { score, playedAtMs } = item;
      if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) continue;
      if (typeof playedAtMs !== 'number' || !Number.isFinite(playedAtMs)) continue;
      official[key] = { score, playedAtMs };
    }
  }
  return { version: 1, official };
}

function trimHistory(official: Record<string, DayRecord>): void {
  const keys = Object.keys(official).sort();
  for (const key of keys.slice(0, Math.max(0, keys.length - HISTORY_CAP))) delete official[key];
}

function streakOf(doneDays: ReadonlySet<number>, todayNum: number): number {
  let cursor = doneDays.has(todayNum) ? todayNum : todayNum - 1;
  let streak = 0;
  while (doneDays.has(cursor)) {
    streak++;
    cursor--;
  }
  return streak;
}

export function createDailyChallenge(storage: MetaStorage | null = null): DailyChallenge {
  const memory = restoreSave(readStoredJson(storage, STORAGE_KEY));
  let practiceCount = 0;
  // 「済ませた日」の集合は、履歴が増えても info() のたびに全件の日付検証を
  // 繰り返さないよう遅延で作り、記録が変わる completeOfficial でだけ捨てる
  let doneDaysCache: ReadonlySet<number> | null = null;
  const doneDays = (): ReadonlySet<number> => {
    if (doneDaysCache === null) {
      const days = new Set<number>();
      for (const key of Object.keys(memory.official)) {
        const n = dayNumberOf(key);
        if (n !== null) days.add(n);
      }
      doneDaysCache = days;
    }
    return doneDaysCache;
  };

  const persist = (): void => writeStoredJson(storage, STORAGE_KEY, memory);

  const api: DailyChallenge = {
    info(nowMs) {
      const dateKey = jstDateKey(nowMs);
      return {
        dateKey,
        seed: dailySeed(dateKey),
        officialDone: Object.hasOwn(memory.official, dateKey),
        streak: streakOf(doneDays(), dayNumberOf(dateKey) ?? 0),
      };
    },
    beginOfficial(nowMs) {
      const dateKey = jstDateKey(nowMs);
      if (Object.hasOwn(memory.official, dateKey)) return null;
      return { mode: 'official', dateKey, seed: dailySeed(dateKey) };
    },
    beginPractice(nowMs) {
      const dateKey = jstDateKey(nowMs);
      return { mode: 'practice', dateKey, seed: practiceSeed(dateKey, practiceCount++) };
    },
    begin(nowMs) {
      return api.beginOfficial(nowMs) ?? api.beginPractice(nowMs);
    },
    completeOfficial(run, result) {
      if (run.mode !== 'official') return false;
      const day = dayNumberOf(run.dateKey);
      if (day === null) return false;
      // 本番ランとして成立しない物は記録しない。シードがその日の本番と違う物
      // （練習ランの張り替え・別系列の盤面の成りすまし）と、終了時刻（JST）より
      // 後の日付を名乗る物（未来日へ記録するとその日の本番を消してしまう）を除く。
      if (run.seed !== dailySeed(run.dateKey)) return false;
      if (Number.isFinite(result.endedAtMs)) {
        const endDay = dayNumberOf(jstDateKey(result.endedAtMs));
        if (endDay !== null && day > endDay) return false;
      }
      if (Object.hasOwn(memory.official, run.dateKey)) return false;
      memory.official[run.dateKey] = {
        score: Math.max(0, Math.floor(Number.isFinite(result.score) ? result.score : 0)),
        playedAtMs: Number.isFinite(result.endedAtMs) ? result.endedAtMs : 0,
      };
      trimHistory(memory.official);
      doneDaysCache = null;
      persist();
      return true;
    },
    history() {
      return Object.entries(memory.official)
        .map(([dateKey, r]) => ({ dateKey, score: r.score, playedAtMs: r.playedAtMs }))
        .sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
    },
  };
  return api;
}
