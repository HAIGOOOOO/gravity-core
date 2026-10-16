import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../contracts/game';
import { createAutoPlay } from '../fixtures';
import { createCodexStore } from './codex';
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
