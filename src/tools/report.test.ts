import { describe, expect, it } from 'vitest';
import type { PlayResult } from './batch';
import { balanceTable, formatNumber, formatRange, markdownTable, seedTable, statsTable } from './report';
import { summarize } from './stats';

const base: PlayResult = {
  seed: 1,
  ticks: 1200,
  seconds: 10,
  score: 1000,
  bestTier: 3,
  launches: 8,
  merges: 4,
  mergesPerLaunch: 0.5,
  supernovas: 0,
  maxChain: 2,
  heat75Count: 1,
  overLimitSeconds: 5,
  timedOut: false,
};

describe('formatNumber', () => {
  it('整数はそのまま、小数は 1 桁、NaN や無限は「—」', () => {
    expect(formatNumber(42)).toBe('42');
    expect(formatNumber(128460)).toBe('128460');
    expect(formatNumber(-7)).toBe('-7');
    expect(formatNumber(12.34)).toBe('12.3');
    expect(formatNumber(NaN)).toBe('—');
    expect(formatNumber(Infinity)).toBe('—');
  });
});

describe('formatRange', () => {
  it('「中央値（10%〜90%）」の形になる', () => {
    // [1..5] → 中央値 3、10% = 1.4、90% = 4.6
    expect(formatRange(summarize([1, 2, 3, 4, 5]))).toBe('3（1.4〜4.6）');
  });
});

describe('markdownTable', () => {
  it('ヘッダ・区切り・行を | でつなぐ', () => {
    expect(
      markdownTable(
        ['a', 'b'],
        [
          ['1', '2'],
          ['3', '4'],
        ],
      ),
    ).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |');
  });
});

describe('balanceTable', () => {
  it('ボットごとの行を出す（打ち切り数も数える）', () => {
    const t = balanceTable([
      { name: 'a', runs: [base, { ...base, score: 3000, timedOut: true }] },
      { name: 'b', runs: [base] },
    ]);
    const lines = t.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('ボット');
    expect(lines[0]).toContain('限界越え秒');
    expect(lines[0]).toContain('合体効率');
    expect(lines[2]).toContain('| a | 2 |');
    // 得点 2 件の中央値は 2000
    expect(lines[2]).toContain('2000');
    // 合体効率（0.5 の平均）は平均値で出す
    expect(lines[2]).toContain('| 0.5 |');
    // 打ち切り列は行の最後（a は 1 件、b は 0 件）
    expect(lines[2]).toMatch(/\| 1 \|$/);
    expect(lines[3]).toMatch(/\| 0 \|$/);
  });

  it('0 回の行は「—」で埋まり、打ち切りは 0', () => {
    const line = balanceTable([{ name: 'empty', runs: [] }]).split('\n')[2]!;
    expect(line).toContain('empty');
    expect(line).toContain('—');
    expect(line).toMatch(/\| 0 \|$/);
  });
});

describe('statsTable', () => {
  it('見出し + 指標 10 行の表になる', () => {
    const t = statsTable('a', [base]);
    expect(t).toContain('### a');
    expect(t).toContain('得点');
    expect(t).toContain('熱量75超');
    expect(t).toContain('限界越え秒');
    expect(t).toContain('合体効率');
    // 「### a」・空行・ヘッダ・区切り・10 指標 = 14 行
    expect(t.split('\n')).toHaveLength(14);
  });

  it('0 件でも表を作れる（値はすべて「—」）', () => {
    const t = statsTable('empty', []);
    expect(t).toContain('### empty');
    expect(t.split('\n')).toHaveLength(14);
    expect(t).toContain('—');
  });
});

describe('seedTable', () => {
  it('秒数の短い順に count 件だけ出す', () => {
    const runs = [
      { ...base, seed: 301, seconds: 30 },
      { ...base, seed: 101, seconds: 10 },
      { ...base, seed: 201, seconds: 20 },
    ];
    const t = seedTable('x', runs, 2);
    const lines = t.split('\n');
    // 「### x（…）」・空行・ヘッダ・区切り・2 行 = 6 行
    expect(lines).toHaveLength(6);
    expect(t).toContain('### x');
    expect(lines[4]).toContain('| 101 |');
    expect(lines[5]).toContain('| 201 |');
    expect(t).not.toContain('| 301 |');
  });

  it('打ち切りの行に「はい」が付き、件数が足りなくても全部出す', () => {
    const t = seedTable('x', [{ ...base, seed: 77, timedOut: true }], 8);
    expect(t).toContain('| 77 |');
    expect(t).toContain('はい');
    expect(t.split('\n')).toHaveLength(5);
  });

  it('0 件なら表だけ（行なし）', () => {
    const t = seedTable('x', [], 8);
    expect(t).toContain('### x');
    // 「### x（…）」・空行・ヘッダ・区切り = 4 行
    expect(t.split('\n')).toHaveLength(4);
  });
});
