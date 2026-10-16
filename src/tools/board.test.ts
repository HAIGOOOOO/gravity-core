// 盤面の詰まりと熱の滞在の計測のテスト。
// 3 層で確かめる:
//   - heatBand / createBoardTracker / summarizeBoardBatch: 偽の盤面で計算だけ（速い）
//   - measureBoard / measureBoardBatch: 実シミュレーションで端から端まで

import { describe, expect, it } from 'vitest';
import type { BodyView, GameSnapshot } from '../contracts/game';
import { at } from '../fixtures/index';
import { HEAT_STATE_LIMITS, LIMIT_RADIUS, TICK_HZ } from '../game/constants';
import type { SimulationSetup } from '../game/simulation';
import { measureAccuracy } from './accuracy';
import {
  createBoardTracker,
  heatBand,
  HEAT_BAND_COUNT,
  measureBoard,
  measureBoardBatch,
  summarizeBoardBatch,
  type BoardSummary,
} from './board';
import { mergeBot, randomBot, type Bot } from './bots';

/** 積もるとリングをはみ出す 3 体の山（batch.test.ts と同じ形。熱量 95 で始める） */
const PILE: SimulationSetup = {
  bodies: [at(7, 130, 0), at(6, 280, 0), at(5, 400, 0)],
  heat: 95,
  bestTier: 8,
};

function snap(over: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    tick: 0,
    phase: 'active',
    bodies: [],
    heat: 0,
    overLimit: false,
    score: 0,
    bestTierThisRun: 0,
    nextQueue: [0, 0, 0],
    launchCooldownLeftSeconds: 0,
    seed: 1,
    stats: { launches: 0, merges: 0, supernovas: 0, maxChain: 0 },
    ...over,
  };
}

function body(over: Partial<BodyView> = {}): BodyView {
  return {
    id: 1,
    tier: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: 14,
    bornTick: 0,
    chain: 0,
    chainUntilTick: 0,
    overLimit: false,
    ...over,
  };
}

/** まとめの見本を、帯の tick 数から矛盾なく作る */
function summary(ticks: number, bands: readonly number[], over: Partial<BoardSummary> = {}): BoardSummary {
  return {
    ticks,
    seconds: ticks / TICK_HZ,
    bodies: { n: 2, mean: 7.5, median: 7.5, p10: 5.5, p90: 9.5, min: 5, max: 10 },
    fillRatio: { n: 2, mean: 0.3, median: 0.3, p10: 0.22, p90: 0.38, min: 0.2, max: 0.4 },
    overLimitRate: 0.2,
    heatBandSeconds: bands.map((t) => t / TICK_HZ),
    firstHotSeconds: null,
    endBodies: null,
    endFillRatio: null,
    endHeat: null,
    ...over,
  };
}

describe('heatBand', () => {
  it('境目の値は下の帯に入れる（heat75Count と揃えて「75 はまだ臨界でない」）', () => {
    const [a, b, c] = HEAT_STATE_LIMITS; // 25, 50, 75
    expect(HEAT_BAND_COUNT).toBe(4);
    expect(heatBand(0)).toBe(0);
    expect(heatBand(a)).toBe(0);
    expect(heatBand(a + 0.01)).toBe(1);
    expect(heatBand(b)).toBe(1);
    expect(heatBand(b + 0.01)).toBe(2);
    expect(heatBand(c)).toBe(2);
    expect(heatBand(c + 0.01)).toBe(3);
    expect(heatBand(100)).toBe(3);
  });
});

describe('createBoardTracker', () => {
  it('各 tick の天体数・占有率・熱量帯・限界越えをまとめる', () => {
    const tr = createBoardTracker();
    // 半径 160 の天体 2 体 → 面積 2·160²、リング面積 320² → 占有率 0.5
    tr.onStep(snap({ bodies: [body({ radius: 160 }), body({ id: 2, radius: 160 })], heat: 10 }));
    tr.onStep(snap({ bodies: [body({ radius: LIMIT_RADIUS })], heat: 60, overLimit: true }));
    tr.onStep(snap({ heat: 80 })); // 空の盤面
    const s = tr.finish();
    expect(s.ticks).toBe(3);
    expect(s.seconds).toBeCloseTo(3 / TICK_HZ, 9);
    // 天体数 [2, 1, 0] → 中央 1・最大 2
    expect(s.bodies.n).toBe(3);
    expect(s.bodies.median).toBe(1);
    expect(s.bodies.max).toBe(2);
    // 占有率 [0.5, 1, 0] → 中央 0.5・最大 1
    expect(s.fillRatio.median).toBeCloseTo(0.5, 9);
    expect(s.fillRatio.max).toBe(1);
    // 3 tick 中 1 tick が限界越え
    expect(s.overLimitRate).toBeCloseTo(1 / 3, 9);
    // 熱量 10 → 安定、60 → 過熱、80 → 臨界
    expect(s.heatBandSeconds).toEqual([1 / TICK_HZ, 0, 1 / TICK_HZ, 1 / TICK_HZ]);
  });

  it('何も記録しなければ tick 0・率は NaN、初臨界と終了時の値は null', () => {
    const s = createBoardTracker().finish();
    expect(s.ticks).toBe(0);
    expect(s.seconds).toBe(0);
    expect(s.bodies.n).toBe(0);
    expect(s.bodies.median).toBeNaN();
    expect(s.overLimitRate).toBeNaN();
    expect(s.heatBandSeconds).toEqual([0, 0, 0, 0]);
    expect(s.firstHotSeconds).toBeNull();
    expect(s.endBodies).toBeNull();
    expect(s.endFillRatio).toBeNull();
    expect(s.endHeat).toBeNull();
  });

  it('初めて「臨界」に入った tick を秒で残す（一度入れば以降は更新しない）', () => {
    const tr = createBoardTracker();
    tr.onStep(snap({ tick: 10, heat: 20 })); // 安定
    tr.onStep(snap({ tick: 40, heat: 80 })); // 臨界（初）
    tr.onStep(snap({ tick: 60, heat: 90 })); // 臨界のまま
    tr.onStep(snap({ tick: 80, heat: 30 })); // 上昇まで戻る
    expect(tr.finish().firstHotSeconds).toBeCloseTo(40 / TICK_HZ, 9);
  });

  it('75 ちょうどはまだ臨界ではない。一度も入らなければ null', () => {
    const tr = createBoardTracker();
    tr.onStep(snap({ tick: 1, heat: 75 }));
    tr.onStep(snap({ tick: 2, heat: 74 }));
    expect(tr.finish().firstHotSeconds).toBeNull();
  });

  it('終わった tick の天体数・占有率・熱量を残す', () => {
    const tr = createBoardTracker();
    tr.onStep(snap({ tick: 1, bodies: [body({ radius: 160 })], heat: 10 }));
    tr.onStep(
      snap({ tick: 2, bodies: [body({ radius: 160 }), body({ id: 2, radius: 160 })], heat: 60 }),
    );
    const s = tr.finish();
    expect(s.endBodies).toBe(2);
    // 半径 160 の天体 2 体 → 2·160² / 320² = 0.5
    expect(s.endFillRatio).toBeCloseTo(0.5, 9);
    expect(s.endHeat).toBe(60);
  });
});

describe('summarizeBoardBatch', () => {
  it('「一番詰まった瞬間」と「ふだん」を、回ごとの値の分布にする', () => {
    const a = summary(120, [60, 30, 20, 10]); // bodies 中央 7.5・最大 10、占有率 中央 0.3・最大 0.4
    const b = summary(240, [120, 60, 40, 20], {
      bodies: { n: 2, mean: 8, median: 8, p10: 7.2, p90: 8.8, min: 7, max: 9 },
      fillRatio: { n: 2, mean: 0.2, median: 0.2, p10: 0.12, p90: 0.28, min: 0.1, max: 0.3 },
    });
    const s = summarizeBoardBatch([a, b]);
    expect(s.runs).toBe(2);
    // 一番詰まった瞬間: 10 と 9 → 中央 9.5
    expect(s.peakBodies.median).toBe(9.5);
    expect(s.peakBodies.max).toBe(10);
    // ふだん: 7.5 と 8 → 中央 7.75
    expect(s.usualBodies.median).toBe(7.75);
    // 占有率の最大: 0.4 と 0.3 → 中央 0.35
    expect(s.peakFill.median).toBeCloseTo(0.35, 9);
    expect(s.usualFill.median).toBeCloseTo(0.25, 9);
    // 帯は全回・全 tick を合わせた割合（b の方が長いので b 側に傾く）
    expect(s.heatBandRate[0]).toBeCloseTo(0.5, 9);
    expect(s.heatBandRate[1]).toBeCloseTo(0.25, 9);
    expect(s.heatBandRate.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 9);
    // 限界越え率は回ごとの率の分布
    expect(s.overLimitRate.median).toBe(0.2);
  });

  it('臨界に入った率・入った秒の分布・終了時の盤面をまとめる（null の回は分布から外す）', () => {
    const a = summary(120, [60, 30, 20, 10], {
      firstHotSeconds: 30,
      endBodies: 8,
      endFillRatio: 0.4,
      endHeat: 90,
    });
    const b = summary(240, [120, 60, 40, 20], {
      firstHotSeconds: 60,
      endBodies: 6,
      endFillRatio: 0.2,
      endHeat: 20,
    });
    const c = summary(120, [120, 0, 0, 0]); // 臨界にも終了時の値も無い回（firstHot・end* は null）
    const s = summarizeBoardBatch([a, b, c]);
    expect(s.runs).toBe(3);
    // 臨界に入ったのは 2/3 回
    expect(s.hotRate).toBeCloseTo(2 / 3, 9);
    // 入った回だけの [30, 60] → 中央 45
    expect(s.firstHotSeconds.n).toBe(2);
    expect(s.firstHotSeconds.median).toBe(45);
    // 終了時の値は c を除いた [8,6]・[0.4,0.2]・[90,20]
    expect(s.endBodies.n).toBe(2);
    expect(s.endBodies.median).toBe(7);
    expect(s.endFillRatio.median).toBeCloseTo(0.3, 9);
    expect(s.endHeat.median).toBe(55);
  });

  it('空なら回数 0・値は NaN', () => {
    const s = summarizeBoardBatch([]);
    expect(s.runs).toBe(0);
    expect(s.peakBodies.median).toBeNaN();
    expect(s.overLimitRate.median).toBeNaN();
    expect(s.heatBandRate).toEqual([NaN, NaN, NaN, NaN]);
    expect(s.hotRate).toBeNaN();
    expect(s.firstHotSeconds.median).toBeNaN();
    expect(s.endBodies.median).toBeNaN();
    expect(s.endFillRatio.median).toBeNaN();
    expect(s.endHeat.median).toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// 実シミュレーションで端から端まで

describe('実シミュレーションでの計測', () => {
  it('記録した tick 数と帯の合計が、プレイの時間と一致する', () => {
    const { result, summary } = measureBoard(randomBot(3), { seed: 3, maxTicks: 10 * TICK_HZ });
    expect(summary.ticks).toBe(result.ticks);
    expect(summary.seconds).toBeCloseTo(result.seconds, 9);
    const total = summary.heatBandSeconds.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(result.seconds, 9);
    // 開始時に START_BODY が置かれるので、盤面はいつも 1 体以上
    expect(summary.bodies.min).toBeGreaterThanOrEqual(1);
    expect(summary.fillRatio.min).toBeGreaterThan(0);
    // 熱がほとんど上がらない普通のプレイは、滞在のほとんどが「安定」
    expect(summary.heatBandSeconds[0]).toBeGreaterThan(0);
  });

  it('はみ出す山の盤面では、限界越え率と「臨界」の滞在が出る', () => {
    const { result, summary } = measureBoard(randomBot(1), {
      seed: 1,
      maxTicks: 30 * TICK_HZ,
      setup: PILE,
    });
    // 熱量 100 で打ち切りではなく終了
    expect(result.timedOut).toBe(false);
    expect(summary.overLimitRate).toBeGreaterThan(0);
    // 熱量 95 開始 → ほぼ最初から「臨界」
    expect(summary.heatBandSeconds[3]).toBeGreaterThan(0);
    expect(summary.bodies.max).toBeGreaterThanOrEqual(3);
  });

  it('撃てないボットなら、開始時の天体だけが記録される', () => {
    const stubborn: Bot = { name: 'stubborn', decide: () => ({ originAngleRadians: 0, vx: 0, vy: 0 }) };
    const { result, summary } = measureBoard(stubborn, { seed: 1, maxTicks: 10 * TICK_HZ });
    expect(result.launches).toBe(0);
    expect(summary.bodies.max).toBe(1); // START_BODY だけ
    expect(summary.heatBandSeconds[0]).toBeCloseTo(result.seconds, 9); // 全部「安定」
    // 臨界には入らない。終了時の盤面は開始の 1 体・熱量 0
    expect(summary.firstHotSeconds).toBeNull();
    expect(summary.endBodies).toBe(1);
    expect(summary.endHeat).toBe(0);
  });

  it('終了時の値は最後の tick の盤面と一致する（危なくて持ち直した回も終了時は低い）', () => {
    const { result, sim, summary } = measureBoard(mergeBot(3), { seed: 3, maxTicks: 10 * TICK_HZ });
    const last = sim.getSnapshot();
    expect(last.tick).toBe(result.ticks);
    expect(summary.endBodies).toBe(last.bodies.length);
    expect(summary.endHeat).toBe(last.heat);
    let area = 0;
    for (const b of last.bodies) area += b.radius * b.radius;
    expect(summary.endFillRatio).toBeCloseTo(area / (LIMIT_RADIUS * LIMIT_RADIUS), 9);
    // 終了時の熱量は最高熱量以下（持ち直せば低いまま終わる）
    expect(summary.endHeat!).toBeLessThanOrEqual(result.peakHeat);
  });

  it('熱量 95 開始のはみ出す山では、最初の観測から「臨界」で終了熱量は 100', () => {
    const { result, summary } = measureBoard(randomBot(1), {
      seed: 1,
      maxTicks: 30 * TICK_HZ,
      setup: PILE,
    });
    expect(result.timedOut).toBe(false);
    // 95 開始なので最初の tick ですでに臨界
    expect(summary.firstHotSeconds).toBeCloseTo(1 / TICK_HZ, 9);
    // 熱量 100 で終了したので、終了時の熱量は 100（peak と同じ）
    expect(summary.endHeat).toBe(100);
    expect(result.peakHeat).toBe(100);
  });

  it('決定的: 同じシードで 2 度測るとまとめは全く同じ', () => {
    const a = measureBoard(mergeBot(7), { seed: 7, maxTicks: 10 * TICK_HZ });
    const b = measureBoard(mergeBot(7), { seed: 7, maxTicks: 10 * TICK_HZ });
    expect(a.summary).toEqual(b.summary);
  });

  it('利用側の hooks も最後に呼ぶ（onStep も含む）', () => {
    let steps = 0;
    let launches = 0;
    let eventTicks = 0;
    const { result, summary } = measureBoard(randomBot(2), {
      seed: 2,
      maxTicks: 5 * TICK_HZ,
      hooks: {
        onLaunch: () => launches++,
        onEvents: () => eventTicks++,
        onStep: () => steps++,
      },
    });
    expect(steps).toBe(result.ticks);
    expect(steps).toBe(summary.ticks);
    expect(launches).toBe(result.launches);
    expect(eventTicks).toBe(result.ticks);
  });

  it('measureAccuracy の観察口に混ぜられる（1 まわしで両方取る形）', () => {
    const tracker = createBoardTracker();
    const { shots, result } = measureAccuracy(randomBot(4), {
      seed: 4,
      maxTicks: 5 * TICK_HZ,
      hooks: { onStep: tracker.onStep },
    });
    expect(shots.length).toBe(result.launches);
    expect(tracker.finish().ticks).toBe(result.ticks);
  });
});

describe('measureBoardBatch', () => {
  it('回ごとの結果とまとめ・合算を返す', () => {
    const m = measureBoardBatch(randomBot, { runs: 2, seedStart: 10, maxTicks: 10 * TICK_HZ });
    expect(m.runs).toHaveLength(2);
    expect(m.summaries).toHaveLength(2);
    expect(m.summaries[0]!.ticks).toBe(m.runs[0]!.ticks);
    expect(m.summary.runs).toBe(2);
    expect(m.summary.peakBodies.max).toBeGreaterThanOrEqual(1);
    // 帯の割合は合わせて 1 になる
    expect(m.summary.heatBandRate.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    // 同じ条件でまわし直しても同じ
    const again = measureBoardBatch(randomBot, { runs: 2, seedStart: 10, maxTicks: 10 * TICK_HZ });
    expect(again.summary).toEqual(m.summary);
  });

  it('0 回なら空を返す', () => {
    const m = measureBoardBatch(randomBot, { runs: 0 });
    expect(m.runs).toEqual([]);
    expect(m.summaries).toEqual([]);
    expect(m.summary.runs).toBe(0);
  });
});
