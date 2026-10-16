import { describe, expect, it } from 'vitest';
import { dropAt } from '../fixtures/index';
import { TICK_HZ } from '../game/constants';
import type { AccuracySummary, ShotRecord } from './accuracy';
import { RUN_METRICS, type PlayResult } from './batch';
import { summarizeBoardBatch, type BoardBatchSummary } from './board';
import { tierPace } from './pace';
import {
  accuracyTable,
  balanceTable,
  boardTable,
  diffTable,
  formatNumber,
  formatPercent,
  formatRange,
  markdownTable,
  missTable,
  outcomeTable,
  paceTable,
  seedTable,
  statsTable,
  tierTable,
} from './report';
import { summarize } from './stats';

const base: PlayResult = {
  seed: 1,
  ticks: 1200,
  seconds: 10,
  score: 1000,
  bestTier: 3,
  launches: 8,
  rejects: 0,
  merges: 4,
  mergesPerLaunch: 0.5,
  supernovas: 0,
  maxChain: 2,
  heat75Count: 1,
  peakHeat: 80,
  overLimitSeconds: 5,
  timedOut: false,
};

/** 指標は全部入った射出の見本。表の中身だけ確かめればよいので値は適当でよい */
const shotBase: ShotRecord = {
  seed: 1,
  tick: 0,
  bodyId: 1,
  tier: 0,
  command: dropAt(0),
  predictedEnd: 'body',
  predictedMerge: false,
  predictedHitBodyId: null,
  predictedPoint: null,
  outcome: 'landed',
  landTick: null,
  landPoint: null,
  mergePartners: [],
  mergeTick: null,
};

function shot(over: Partial<ShotRecord>): ShotRecord {
  return { ...shotBase, ...over };
}

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

describe('formatPercent', () => {
  it('0〜1 を % にする。NaN や無限は「—」', () => {
    expect(formatPercent(0.75)).toBe('75%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.004)).toBe('0%');
    expect(formatPercent(NaN)).toBe('—');
    expect(formatPercent(Infinity)).toBe('—');
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
    expect(lines[0]).toContain('熱量Max');
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
  it('見出し + 指標 11 行の表になる', () => {
    const t = statsTable('a', [base]);
    expect(t).toContain('### a');
    expect(t).toContain('得点');
    expect(t).toContain('熱量75超');
    expect(t).toContain('最高熱量');
    expect(t).toContain('限界越え秒');
    expect(t).toContain('合体効率');
    // 「### a」・空行・ヘッダ・区切り・指標の数だけ = 4 + 指標数 行
    expect(t.split('\n')).toHaveLength(4 + RUN_METRICS.length);
    expect(t).toContain('射出失敗');
  });

  it('0 件でも表を作れる（値はすべて「—」）', () => {
    const t = statsTable('empty', []);
    expect(t).toContain('### empty');
    expect(t.split('\n')).toHaveLength(4 + RUN_METRICS.length);
    expect(t).toContain('—');
  });
});

describe('diffTable', () => {
  it('見出しに対の数と打ち切り数、行は指標ごとに「B−A」の分布', () => {
    const a = [
      { ...base, seed: 1, score: 100 },
      { ...base, seed: 2, score: 200, timedOut: true },
    ];
    const b = [
      { ...base, seed: 1, score: 160 },
      { ...base, seed: 2, score: 260 },
    ];
    const t = diffTable('下', '上', a, b);
    expect(t).toContain('### 下 → 上（2 対・打ち切り 1→0）');
    // 「### …」・空行・ヘッダ・区切り・11 指標 = 15 行
    expect(t.split('\n')).toHaveLength(4 + RUN_METRICS.length);
    // 得点の差は +60 と +60 → 差の中央値 60 が載る
    const scoreRow = t.split('\n').find((l) => l.includes('得点'))!;
    expect(scoreRow).toContain('| 60 |');
  });

  it('対が無くても表を作れる（差はすべて「—」）', () => {
    const t = diffTable('a', 'b', [{ ...base, seed: 1 }], [{ ...base, seed: 2 }]);
    expect(t).toContain('0 対');
    expect(t).toContain('—');
  });
});

describe('accuracyTable', () => {
  const acc: AccuracySummary = {
    shots: 10,
    predictedMerges: 4,
    mergeHits: 3,
    mergeHitRate: 0.75,
    mergeMisses: 1,
    actualMerges: 4,
    surpriseMerges: 1,
    landedThenMerged: 2,
    noContact: 0,
    partnerMatchRate: 1,
    landError: summarize([2, 4]),
  };

  it('的中率・外れ・相手一致・着地誤差を列に出す', () => {
    const t = accuracyTable([{ name: 'a', summary: acc }]);
    const lines = t.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('的中率');
    expect(lines[0]).toContain('相手一致');
    expect(lines[2]).toBe('| a | 10 | 4 | 3 | 75% | 1 | 1 | 2 | 100% | 3 |');
  });

  it('率や誤差が NaN なら「—」で埋める', () => {
    const t = accuracyTable([
      { name: 'empty', summary: { ...acc, shots: 0, mergeHitRate: NaN, partnerMatchRate: NaN, landError: summarize([]) } },
    ]);
    const line = t.split('\n')[2]!;
    expect(line).toContain('empty');
    expect(line).toContain('—');
  });
});

describe('outcomeTable', () => {
  it('結末ごとの件数を「合体を予測した/していない」で分けて出す', () => {
    const shots = [
      shot({ predictedMerge: true, outcome: 'merged' }),
      shot({ predictedMerge: true, outcome: 'landed' }),
      shot({ predictedMerge: false, outcome: 'noContact' }),
    ];
    const t = outcomeTable('b', shots);
    expect(t).toContain('### b: 予測 × 結末（3 射）');
    const lines = t.split('\n');
    // 見出し・空行・ヘッダ・区切り・結末 4 行 = 8 行
    expect(lines).toHaveLength(8);
    expect(lines[4]).toBe('| 合体 | 1 | 0 | 1 |');
    expect(lines[5]).toBe('| 着地 | 1 | 0 | 1 |');
    expect(lines[6]).toBe('| 着地→合体 | 0 | 0 | 0 |');
    expect(lines[7]).toBe('| 未接触 | 0 | 1 | 1 |');
  });

  it('0 件なら見出しと空の表だけ', () => {
    const t = outcomeTable('empty', []);
    expect(t).toContain('（0 射）');
    expect(t.split('\n')).toHaveLength(8);
  });
});

describe('missTable', () => {
  it('「合体を予測したのに合体しなかった」射出だけを、シード→tick 順に出す', () => {
    const shots = [
      shot({ seed: 2, tick: 50, bodyId: 9, tier: 3, predictedMerge: true, outcome: 'landed', predictedHitBodyId: 5, landTick: 90 }),
      shot({ seed: 1, tick: 80, bodyId: 8, predictedMerge: true, outcome: 'noContact', predictedHitBodyId: 4 }),
      shot({ seed: 2, tick: 10, bodyId: 7, predictedMerge: true, outcome: 'landedThenMerged', predictedHitBodyId: 6, landTick: 30 }),
      shot({ seed: 2, tick: 99, bodyId: 6, predictedMerge: true, outcome: 'merged', predictedHitBodyId: 1 }), // 的中は出ない
      shot({ seed: 1, tick: 5, bodyId: 5, predictedMerge: false, outcome: 'landed' }), // 予測していない着地は出ない
    ];
    const t = missTable('m', shots, 10);
    const lines = t.split('\n');
    expect(t).toContain('### m: 予測合体の外れ（3 件中 3 件）');
    // 見出し・空行・ヘッダ・区切り・3 行 = 7 行
    expect(lines).toHaveLength(7);
    // シード→tick 順: (1,80) → (2,10) → (2,50)
    expect(lines[4]).toContain('| 1 | 80 |');
    expect(lines[5]).toContain('| 2 | 10 |');
    expect(lines[6]).toContain('| 2 | 50 |');
    // 結末の表示名と「着地まで」の tick 差（90 - 50 = 40）
    expect(lines[6]).toContain('着地');
    expect(lines[6]).toContain('| 40 |');
    // 未接触は着地まで・誤差とも「—」
    expect(lines[4]).toContain('未接触');
  });

  it('件数を超えた分は切る。撃った角度と速さを度数・px/秒で出す', () => {
    const shots = [
      // 1 rad ≈ 57.3°、3-4-5 の速さ 500（どちらも丸めに左右されない値を選んだ）
      shot({ seed: 1, tick: 1, predictedMerge: true, outcome: 'landed', command: { originAngleRadians: 1, vx: -300, vy: -400 } }),
      shot({ seed: 1, tick: 2, predictedMerge: true, outcome: 'landed' }),
    ];
    const t = missTable('m', shots, 1);
    expect(t).toContain('2 件中 1 件');
    const lines = t.split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[4]).toContain('| 57.3 |');
    expect(lines[4]).toContain('| 500 |');
  });

  it('外れが無ければ見出しと空の表だけ', () => {
    const t = missTable('m', [shot({ predictedMerge: true, outcome: 'merged' })], 12);
    expect(t).toContain('0 件中 0 件');
    expect(t.split('\n')).toHaveLength(4);
  });

  it('件数 0 なら外れがあっても行を出さない', () => {
    const t = missTable('m', [shot({ predictedMerge: true, outcome: 'landed' })], 0);
    expect(t).toContain('1 件中 0 件');
    expect(t.split('\n')).toHaveLength(4);
  });
});

describe('tierTable', () => {
  it('Tier ごとの射出数・的中率・結末の内訳を並べる', () => {
    const shots = [
      shot({ tier: 0, predictedMerge: true, outcome: 'merged' }),
      shot({ tier: 0, predictedMerge: true, outcome: 'landed' }),
      shot({ tier: 3, outcome: 'noContact' }),
    ];
    const t = tierTable('x', shots);
    expect(t).toContain('### x: Tier ごとの的中率');
    const lines = t.split('\n');
    // 見出し・空行・ヘッダ・区切り・2 行 = 6 行
    expect(lines).toHaveLength(6);
    expect(lines[4]).toBe('| 0 | 2 | 2 | 50% | 1 | 0 | 0 |');
    expect(lines[5]).toBe('| 3 | 1 | 0 | — | 0 | 0 | 1 |');
  });

  it('0 件なら見出しと空の表だけ', () => {
    const t = tierTable('x', []);
    expect(t).toContain('### x');
    expect(t.split('\n')).toHaveLength(4);
  });
});

describe('paceTable', () => {
  it('Tier ごとの到達率と秒数の表。届かない Tier も 0% で出す', () => {
    const paces = [
      tierPace(1, [0, TICK_HZ, 2 * TICK_HZ, null]),
      tierPace(2, [0, 2 * TICK_HZ, null, null]),
    ];
    const t = paceTable('p', paces);
    expect(t).toContain('### p: Tier ごとの初到達');
    const lines = t.split('\n');
    // 見出し・空行・ヘッダ・区切り・9 Tier = 13 行
    expect(lines).toHaveLength(13);
    // Tier 0: 2/2 到達・全部 0 秒
    expect(lines[4]).toBe('| 0 | 100% | 0 | 0 | 0 | 0 |');
    // Tier 1: 届いた 2 件（1 秒と 2 秒）の分布
    expect(lines[5]).toBe('| 1 | 100% | 1.5 | 1.5 | 1.1 | 1.9 |');
    // Tier 2: 1/2 = 50%
    expect(lines[6]).toBe('| 2 | 50% | 2 | 2 | 2 | 2 |');
    // Tier 3: 0/2 → 秒は「—」
    expect(lines[7]).toBe('| 3 | 0% | — | — | — | — |');
  });

  it('0 件なら率は「—」で埋まる', () => {
    const t = paceTable('empty', []);
    expect(t).toContain('### empty');
    expect(t.split('\n')).toHaveLength(13);
    expect(t).toContain('| 0 | — | — | — | — | — |');
  });
});

describe('boardTable', () => {
  it('詰まり具合・熱の帯・限界越え率を列に出す', () => {
    const s: BoardBatchSummary = {
      runs: 3,
      peakBodies: summarize([10, 12, 14]),
      peakFill: summarize([0.4, 0.6]),
      usualBodies: summarize([6, 7, 8]),
      usualFill: summarize([0.2, 0.3]),
      heatBandRate: [0.7, 0.15, 0.1, 0.05],
      overLimitRate: summarize([0.02, 0.04]),
    };
    const t = boardTable([{ name: 'a', summary: s }]);
    const lines = t.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('最大天体');
    expect(lines[0]).toContain('限界越え率');
    // 最大天体(中央) = 12、(90%) = 13.6、占有率 = 50% / 25%、臨界 = 5%
    expect(lines[2]).toBe('| a | 3 | 12 | 13.6 | 50% | 25% | 70% | 15% | 10% | 5% | 3% |');
  });

  it('0 件でも「—」で埋められる', () => {
    const t = boardTable([{ name: 'empty', summary: summarizeBoardBatch([]) }]);
    expect(t.split('\n')).toHaveLength(3);
    expect(t).toContain('empty');
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
