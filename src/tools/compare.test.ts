import { describe, expect, it } from 'vitest';
import { TICK_HZ } from '../game/constants';
import { runBatch, RUN_METRICS, type PlayResult } from './batch';
import { randomBot } from './bots';
import { diffRuns } from './compare';

/** 指標は全部入った見本。差の計算だけ確かめればよいので中身は適当でよい */
function run(over: Partial<PlayResult>): PlayResult {
  return {
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
    ...over,
  };
}

describe('diffRuns（同じシードどうしの差）', () => {
  it('同じシードだけを対にし、差は B − A。片側だけのシードは外す', () => {
    const a = [run({ seed: 1, score: 100, seconds: 10 }), run({ seed: 2, score: 200 }), run({ seed: 9 })];
    const b = [run({ seed: 2, score: 260 }), run({ seed: 1, score: 150 }), run({ seed: 5 })];
    const d = diffRuns(a, b);
    expect(d.paired).toBe(2);
    expect(d.seeds).toEqual([1, 2]);
    expect(d.onlyA).toBe(1); // seed 9
    expect(d.onlyB).toBe(1); // seed 5
    // 得点の差: +50 と +60 → 平均・中央値 55、最小 50、最大 60
    expect(d.deltas.score.mean).toBe(55);
    expect(d.deltas.score.median).toBe(55);
    expect(d.deltas.score.min).toBe(50);
    expect(d.deltas.score.max).toBe(60);
    // 秒数の差: 0 と 0
    expect(d.deltas.seconds.mean).toBe(0);
  });

  it('差は全部の指標について出る', () => {
    const a = [run({ seed: 1, score: 100, merges: 2, maxChain: 1 })];
    const b = [run({ seed: 1, score: 350, merges: 7, maxChain: 4 })];
    const d = diffRuns(a, b);
    for (const m of RUN_METRICS) expect(d.deltas[m].n).toBe(1);
    expect(d.deltas.score.mean).toBe(250);
    expect(d.deltas.merges.mean).toBe(5);
    expect(d.deltas.maxChain.mean).toBe(3);
  });

  it('対が 1 つも無ければ paired は 0、差は NaN', () => {
    const d = diffRuns([run({ seed: 1 })], [run({ seed: 2 })]);
    expect(d.paired).toBe(0);
    expect(d.onlyA).toBe(1);
    expect(d.onlyB).toBe(1);
    expect(d.deltas.score.mean).toBeNaN();
  });

  it('同じ側でシードが重複していたら、最初の 1 件だけを使う', () => {
    const a = [run({ seed: 1, score: 100 }), run({ seed: 1, score: 999 })];
    const b = [run({ seed: 1, score: 150 })];
    const d = diffRuns(a, b);
    expect(d.paired).toBe(1);
    expect(d.deltas.score.mean).toBe(50); // 999 ではなく先に出た 100 と対になる
  });

  it('B 側でシードが重複していても、最初の 1 件だけを使う（残りは onlyB にも数えない）', () => {
    const a = [run({ seed: 1, score: 100 })];
    const b = [run({ seed: 1, score: 150 }), run({ seed: 1, score: 999 })];
    const d = diffRuns(a, b);
    expect(d.paired).toBe(1);
    expect(d.onlyB).toBe(0); // 2 件目は対になった 1 件目と同じシードなので端数扱いしない
    expect(d.deltas.score.mean).toBe(50); // 999 ではなく先に出た 150 と対になる
  });

  it('空どうしでも落ちない', () => {
    const d = diffRuns([], []);
    expect(d.paired).toBe(0);
    expect(d.deltas.score.mean).toBeNaN();
  });

  it('同じまわし結果どうしの差は全部 0（実際のまわしで確かめる）', () => {
    const runs = runBatch(randomBot, { runs: 3, seedStart: 40, maxTicks: 10 * TICK_HZ });
    const d = diffRuns(runs, runs);
    expect(d.paired).toBe(3);
    expect(d.onlyA).toBe(0);
    expect(d.onlyB).toBe(0);
    for (const m of RUN_METRICS) {
      expect(d.deltas[m].mean).toBe(0);
      expect(d.deltas[m].max).toBe(0);
    }
  });
});
