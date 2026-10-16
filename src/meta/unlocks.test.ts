import { describe, expect, it } from 'vitest';
import { UNLOCKS, evaluateUnlocks, type UnlockContext } from './unlocks';

const C0: UnlockContext = { runs: 0, bestScore: 0, codexFound: 0, officialDays: 0 };
const ids = (list: readonly { id: string }[]): string[] => list.map(e => e.id);

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
