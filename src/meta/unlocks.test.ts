import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../contracts/game';
import { createAutoPlay } from '../fixtures';
import { CODEX_ENTRIES, createCodexStore } from './codex';
import { createDailyChallenge } from './daily';
import type { MetaStorage } from './storage';
import {
  evaluateUnlocks,
  newlyUnlocked,
  unlockContextFrom,
  UNLOCKS,
  type UnlockContext,
} from './unlocks';

const C0: UnlockContext = { runs: 0, bestScore: 0, codexFound: 0, officialDays: 0 };
const ids = (list: readonly { id: string }[]): string[] => list.map(e => e.id);

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

const DAY_MS = 86_400_000;
/** JST の y-m-d 0:00 に相当する UTC ms。 */
const jstMs = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) - 9 * 3_600_000;

describe('解放の表', () => {
  it('最初は全部閉じている', () => {
    const result = evaluateUnlocks(C0);
    expect(result.unlockedCount).toBe(0);
    expect(result.total).toBe(UNLOCKS.length);
    expect(result.locked).toHaveLength(UNLOCKS.length);
    // 未開放でも「あとどれくらいか」は 0 で返る
    expect(result.locked.every(v => v.progress === 0)).toBe(true);
  });

  it('遊ぶほど開いていく（最初の 10 分で複数、先は長く）', () => {
    expect(ids(evaluateUnlocks({ ...C0, runs: 1 }).unlocked)).toEqual(['records']);
    expect(ids(evaluateUnlocks({ ...C0, runs: 1, codexFound: 1 }).unlocked)).toEqual(
      expect.arrayContaining(['records', 'codex']),
    );
    const early = evaluateUnlocks({ ...C0, runs: 3, codexFound: 1 });
    expect(ids(early.unlocked)).toEqual(expect.arrayContaining(['records', 'codex', 'replay', 'daily']));
    // まだ先がある
    expect(early.unlockedCount).toBeLessThan(early.total);
    expect(ids(evaluateUnlocks({ ...C0, runs: 10 }).unlocked)).toContain('growth');
  });

  it('図鑑の数・得点・日替わり日数の条件も判定できる', () => {
    expect(ids(evaluateUnlocks({ ...C0, codexFound: 5 }).unlocked)).toEqual(
      expect.arrayContaining(['codex', 'codex-hints']),
    );
    expect(ids(evaluateUnlocks({ ...C0, codexFound: 15 }).unlocked)).toContain('observatory');
    expect(ids(evaluateUnlocks({ ...C0, bestScore: 10_000 }).unlocked)).toContain('share');
    expect(ids(evaluateUnlocks({ ...C0, officialDays: 2 }).unlocked)).toContain('daily-history');
  });

  it('未解放の項目は「あと少し」の順に並ぶ', () => {
    // share 9,000/10,000=0.9 が先頭、codex-hints 4/5=0.8 が続くはず
    const result = evaluateUnlocks({ runs: 2, bestScore: 9_000, codexFound: 4, officialDays: 1 });
    const progresses = result.locked.map(v => v.progress);
    expect(progresses).toEqual([...progresses].sort((a, b) => b - a));
    expect(result.locked[0]!.entry.id).toBe('share');
    expect(result.locked[1]!.entry.id).toBe('codex-hints');
  });

  it('条件を全部満たせば全部開き、未開放は空になる', () => {
    const all = evaluateUnlocks({
      runs: 1_000,
      bestScore: 1_000_000,
      codexFound: 40,
      officialDays: 30,
    });
    expect(all.unlockedCount).toBe(all.total);
    expect(all.locked).toHaveLength(0);
  });

  it('同じ状態には同じ結果を返す純粋関数（プレイ中にも確かめられる）', () => {
    const ctx: UnlockContext = { runs: 3, bestScore: 12_000, codexFound: 6, officialDays: 2 };
    expect(evaluateUnlocks(ctx)).toEqual(evaluateUnlocks(ctx));
  });

  it('各項目に人が読める条件文がある', () => {
    for (const entry of UNLOCKS) {
      expect(entry.requirement.length).toBeGreaterThan(0);
      expect(entry.id).not.toBe('');
    }
    expect(new Set(ids(UNLOCKS)).size).toBe(UNLOCKS.length);
  });

  it('どの項目も「開いた」は「進み具合が 1」のときだけ（ずれがあれば表示と矛盾する）', () => {
    const contexts: UnlockContext[] = [];
    for (const runs of [0, 1, 2, 3, 5, 10, 100]) {
      for (const codexFound of [0, 1, 5, 15, 25, 40]) {
        for (const bestScore of [0, 9_999, 10_000, 500_000]) {
          for (const officialDays of [0, 1, 2, 7, 30]) {
            contexts.push({ runs, bestScore, codexFound, officialDays });
          }
        }
      }
    }
    for (const ctx of contexts) {
      for (const entry of UNLOCKS) {
        expect(entry.unlocked(ctx)).toBe(entry.progress(ctx) === 1);
      }
    }
  });

  it('進捗の内訳（measure）も「開いた」と一致し、目標は常に正の数', () => {
    // 変な値（負数・NaN・Infinity）でも表示と判定がずれないことを確かめる
    for (const runs of [-3, 0, 4, 5, 9, 10, 500, Number.POSITIVE_INFINITY]) {
      for (const codexFound of [0, 14, 15, 24, 25]) {
        for (const bestScore of [0, 9_999, 10_000, 100_000, Number.NaN]) {
          for (const officialDays of [0, 1, 2, 6, 7]) {
            const ctx: UnlockContext = { runs, bestScore, codexFound, officialDays };
            for (const entry of UNLOCKS) {
              const m = entry.measure(ctx);
              expect(m.target).toBeGreaterThan(0);
              expect(m.current).toBeGreaterThanOrEqual(0);
              expect(m.current).toBeLessThanOrEqual(m.target);
              expect(entry.unlocked(ctx)).toBe(m.current >= m.target);
            }
          }
        }
      }
    }
  });

  it('条件文は全部ちがう（未解放の項目どうしを見分けられる）', () => {
    const requirements = UNLOCKS.map(e => e.requirement);
    expect(new Set(requirements).size).toBe(requirements.length);
  });

  it('図鑑の数で開く項目は、図鑑の総項目数を条件の上限にする（届かない物を置かない）', () => {
    // 図鑑を全部集めきった状態でも閉じたままの項目が無いか確かめる
    const maxed = evaluateUnlocks({ ...C0, codexFound: CODEX_ENTRIES.length });
    for (const id of ['codex', 'codex-hints', 'observatory', 'stargazer']) {
      expect(ids(maxed.unlocked)).toContain(id);
    }
  });
});

describe('部品から文脈を組み立てる', () => {
  it('図鑑の発見数と本番の日数を実際のストアから取る', () => {
    const codex = createCodexStore(memoryStorage());
    const daily = createDailyChallenge(memoryStorage());
    // 実プレイの盤面で図鑑を進める
    const auto = createAutoPlay(1);
    const events = auto.step();
    codex.feed(events, auto.sim.getSnapshot(), { runIndex: 1, nowMs: jstMs(2026, 10, 16) });
    // 本番を 2 日ぶん済ませる
    const t0 = jstMs(2026, 10, 16) + 3_600_000;
    daily.completeOfficial(daily.beginOfficial(t0)!, { score: 100, endedAtMs: t0 });
    daily.completeOfficial(daily.beginOfficial(t0 + DAY_MS)!, { score: 200, endedAtMs: t0 + DAY_MS });

    const ctx = unlockContextFrom({ runs: 5, bestScore: 12_000, codex, daily });
    expect(ctx.runs).toBe(5);
    expect(ctx.bestScore).toBe(12_000);
    expect(ctx.codexFound).toBeGreaterThanOrEqual(1); // 少なくとも最初の天体は見つかる
    expect(ctx.officialDays).toBe(2);

    expect(ids(evaluateUnlocks(ctx).unlocked)).toEqual(
      expect.arrayContaining(['records', 'codex', 'replay', 'daily', 'stats', 'share', 'daily-history']),
    );
  });

  it('数値が変でも文脈を 0 に丸める', () => {
    const ctx = unlockContextFrom({
      runs: Number.NaN,
      bestScore: -50,
      codex: createCodexStore(null),
      daily: createDailyChallenge(null),
    });
    expect(ctx.runs).toBe(0);
    expect(ctx.bestScore).toBe(0);
    expect(ctx.codexFound).toBe(0);
    expect(ctx.officialDays).toBe(0);
  });

  it('図鑑・日替わり側が変な数を返しても 0 に丸める', () => {
    const ctx = unlockContextFrom({
      runs: 1,
      bestScore: 1,
      codex: { progress: () => ({ found: Number.NaN }) },
      daily: { history: () => ({ length: -3 }) as unknown as readonly unknown[] },
    });
    expect(ctx.codexFound).toBe(0);
    expect(ctx.officialDays).toBe(0);
  });
});

describe('新しく開いた項目', () => {
  it('状態の差分を返す。変化が無ければ空', () => {
    expect(newlyUnlocked(C0, C0)).toHaveLength(0);
    expect(ids(newlyUnlocked(C0, { ...C0, runs: 1 }))).toEqual(['records']);
    const many = ids(
      newlyUnlocked(C0, { runs: 5, bestScore: 12_000, codexFound: 1, officialDays: 0 }),
    );
    expect(many).toEqual(
      expect.arrayContaining(['records', 'codex', 'replay', 'daily', 'stats', 'share']),
    );
  });

  it('一度に複数開くとき、表の順で返す', () => {
    const all = { runs: 100, bestScore: 1_000_000, codexFound: 40, officialDays: 30 };
    expect(ids(newlyUnlocked(C0, all))).toEqual(ids(UNLOCKS));
  });
});

describe('解放の進み具合（実プレイで測る）', () => {
  it('自動プレイを重ねると、解放が閉じる事なく進む', () => {
    const codex = createCodexStore(memoryStorage());
    const daily = createDailyChallenge(memoryStorage());
    let runs = 0;
    let bestScore = 0;
    const counts: number[] = [];
    const unlockedIds = new Set<string>();
    for (let r = 0; r < 8; r++) {
      const auto = createAutoPlay(100 + r);
      const events: GameEvent[] = [];
      for (let i = 0; i < 300 && auto.sim.getSnapshot().phase === 'active'; i++) {
        events.push(...auto.step());
      }
      runs++;
      bestScore = Math.max(bestScore, auto.sim.getSnapshot().score);
      codex.feed(events, auto.sim.getSnapshot(), { runIndex: runs, nowMs: 0 });
      const summary = evaluateUnlocks(unlockContextFrom({ runs, bestScore, codex, daily }));
      counts.push(summary.unlockedCount);
      for (const e of summary.unlocked) unlockedIds.add(e.id);
    }
    // 開いた物が閉じる事は無い
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]!);
    }
    // 8 プレイで、プレイ回数だけで開く 4 件＋図鑑の 1 件は必ず開いている
    expect([...unlockedIds]).toEqual(
      expect.arrayContaining(['records', 'codex', 'replay', 'daily', 'stats']),
    );
    expect(counts[7]).toBeGreaterThanOrEqual(5);
  });
});

// 200 プレイ規模で、どの解放がどのプレイで開くかを実プレイで測る。
// 実測値は console.log で検査出力へ残し、遅すぎる解放・届かない項目の洗い出しに使う。
describe('解放ペース（200 プレイ規模）', () => {
  it('回数・本番日数で開く物は設計した回数で開き、解放は後戻りしない', () => {
    const codex = createCodexStore(memoryStorage());
    const daily = createDailyChallenge(memoryStorage());
    const noon = jstMs(2026, 10, 16) + 12 * 3_600_000; // 深夜項目が混ざらない昼の時刻
    const firstOpenRun = new Map<string, number>();
    const counts: number[] = [];
    let bestScore = 0;
    for (let run = 1; run <= 200; run++) {
      // 3 回に 1 回は「その日の本番」として扱い、日替わり系の解放も実プレイで開ける
      const nowMs = noon + Math.floor((run - 1) / 3) * DAY_MS;
      const official = daily.beginOfficial(nowMs);
      const auto = createAutoPlay(1000 + run);
      const events: GameEvent[] = [];
      // 7.5 秒ぶんか終了まで。解放ペースの主役は回数条件なので、ランは短く切る
      for (let i = 0; i < 900 && auto.sim.getSnapshot().phase === 'active'; i++) {
        events.push(...auto.step());
      }
      const snap = auto.sim.getSnapshot();
      bestScore = Math.max(bestScore, snap.score);
      if (official) {
        daily.completeOfficial(official, { score: snap.score, endedAtMs: nowMs + 60_000 });
      }
      codex.feed(events, snap, { runIndex: run, nowMs });
      const summary = evaluateUnlocks(unlockContextFrom({ runs: run, bestScore, codex, daily }));
      counts.push(summary.unlockedCount);
      for (const e of summary.unlocked) {
        if (!firstOpenRun.has(e.id)) firstOpenRun.set(e.id, run);
      }
    }
    // プレイ回数だけで開く物は、設計した回数の瞬間に開く
    expect(firstOpenRun.get('records')).toBe(1);
    expect(firstOpenRun.get('replay')).toBe(2);
    expect(firstOpenRun.get('daily')).toBe(3);
    expect(firstOpenRun.get('stats')).toBe(5);
    expect(firstOpenRun.get('growth')).toBe(10);
    // 最初の盤面には必ず Tier 0 がいるので、図鑑は 1 プレイ目から育つ
    expect(firstOpenRun.get('codex')).toBe(1);
    // 3 回に 1 回が新しい日の本番 → 2 日ぶんは 4 回目、7 日ぶんは 19 回目に開く
    expect(firstOpenRun.get('daily-history')).toBe(4);
    expect(firstOpenRun.get('daily-regular')).toBe(19);
    // 一度開いた物は閉じない
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]!);
    }
    // 200 プレイで、回数条件の 5 件＋図鑑の入口＋日替わり系の 2 件は必ず開いている
    expect(counts[199]).toBeGreaterThanOrEqual(8);
    console.log(
      `[pace] codex ${codex.progress().found}/${codex.progress().total}` +
        ` best=${bestScore} first-open=${[...firstOpenRun.entries()]
          .map(([id, r]) => `${id}@${r}`)
          .join(' ')}`,
    );
    console.log(
      `[pace] codex unfound: ${codex
        .list()
        .filter(v => !v.found)
        .map(v => v.id)
        .join(' ')}`,
    );
  }, 60_000);
});
