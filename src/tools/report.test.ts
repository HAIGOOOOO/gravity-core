import { describe, expect, it } from 'vitest';
import type { PlayResult } from './batch';
import { balanceTable, formatNumber, formatRange, markdownTable, statsTable } from './report';
import { summarize } from './stats';

const base: PlayResult = {
  seed: 1,
  ticks: 1200,
  seconds: 10,
  score: 1000,
  bestTier: 3,
  launches: 8,
  merges: 4,
  supernovas: 0,
  maxChain: 2,
  heat75Count: 1,
  timedOut: false,
};

describe('formatNumber', () => {
  it('整数はそのまま、小数は 1 桁、NaN や無限は「—」', () => {
    expect(formatNumber(42)).toBe('42');
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
    expect(lines[2]).toContain('| a | 2 |');
    // 得点 2 件の中央値は 2000
    expect(lines[2]).toContain('2000');
    // 打ち切り列は行の最後（a は 1 件、b は 0 件）
    expect(lines[2]).toMatch(/\| 1 \|$/);
    expect(lines[3]).toMatch(/\| 0 \|$/);
  });
});

describe('statsTable', () => {
  it('見出し + 指標 8 行の表になる', () => {
    const t = statsTable('a', [base]);
    expect(t).toContain('### a');
    expect(t).toContain('得点');
    expect(t).toContain('熱量75超');
    // 「### a」・空行・ヘッダ・区切り・8 指標 = 12 行
    expect(t.split('\n')).toHaveLength(12);
  });
});
