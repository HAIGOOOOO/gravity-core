// はみ出しエピソードの計測のテスト。
// 3 層で確かめる:
//   - createOverTracker / summarizeOverBatch: 偽の盤面で計算だけ（速い）
//   - measureOver / measureOverBatch: 実シミュレーションで端から端まで

import { describe, expect, it } from 'vitest';
import type { BodyView, GameSnapshot } from '../contracts/game';
import { at } from '../fixtures/index';
import { TICK_HZ } from '../game/constants';
import type { SimulationSetup } from '../game/simulation';
import { measureAccuracy } from './accuracy';
import {
  createOverTracker,
  measureOver,
  measureOverBatch,
  summarizeOverBatch,
  type OverEpisode,
  type OverSummary,
} from './overlimit';
import { mergeBot, randomBot, type Bot } from './bots';
import { summarize } from './stats';

/** 積もるとリングをはみ出す 3 体の山（batch.test.ts と同じ形。熱量 95 で始める） */
const PILE: SimulationSetup = {
  bodies: [at(7, 130, 0), at(6, 280, 0), at(5, 400, 0)],
  heat: 95,
  bestTier: 8,
};

/** ぎりぎりはみ出す低い山（先端の Tier 1 だけが 8px はみ出る）。熱量 40 でしばらく遊べる */
const MARGIN: SimulationSetup = {
  bodies: [at(7, 126, 0), at(5, 249, 0), at(1, 309, 0)],
  heat: 40,
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

/** まとめの見本を手で作る（summarizeOverBatch の計算だけ確かめる用） */
function summary(episodes: readonly OverEpisode[], ticks = 120): OverSummary {
  return {
    ticks,
    episodes,
    episodeCount: episodes.length,
    overSeconds: episodes.reduce((a, e) => a + e.seconds, 0),
    firstOverSeconds: episodes.length > 0 ? episodes[0]!.startTick / TICK_HZ : null,
    episodeSeconds: summarize(episodes.map((e) => e.seconds)),
    peakOverhang: summarize(episodes.map((e) => e.peakOverhangPx)),
    openAtEnd: episodes.length > 0 && episodes[episodes.length - 1]!.endTick === null,
  };
}

function ep(over: Partial<OverEpisode> = {}): OverEpisode {
  return {
    startTick: 0,
    endTick: 10,
    seconds: 1,
    peakOverhangPx: 10,
    peakAngleRadians: 0,
    peakTier: 0,
    bodyCount: 1,
    ...over,
  };
}

describe('createOverTracker', () => {
  it('「はみ出し→戻り」で 1 つのエピソード。端点と秒数が整合する', () => {
    const tr = createOverTracker();
    tr.onStep(snap({ tick: 10, overLimit: true, bodies: [body({ x: 310, radius: 20, overLimit: true })] }));
    tr.onStep(snap({ tick: 11, overLimit: true, bodies: [body({ x: 310, radius: 20, overLimit: true })] }));
    tr.onStep(snap({ tick: 12 })); // 戻った
    const s = tr.finish();
    expect(s.ticks).toBe(3);
    expect(s.episodeCount).toBe(1);
    const e = s.episodes[0]!;
    expect(e.startTick).toBe(10);
    expect(e.endTick).toBe(12); // 戻ったと観測した tick
    expect(e.seconds).toBeCloseTo(2 / TICK_HZ, 9);
    expect(e.peakOverhangPx).toBeCloseTo(10, 9); // 310 + 20 - 320
    expect(e.peakTier).toBe(0);
    expect(e.bodyCount).toBe(1);
    expect(s.openAtEnd).toBe(false);
    expect(s.firstOverSeconds).toBeCloseTo(10 / TICK_HZ, 9);
    expect(s.overSeconds).toBeCloseTo(2 / TICK_HZ, 9);
  });

  it('戻らずに終わると endTick は null・openAtEnd になる', () => {
    const tr = createOverTracker();
    tr.onStep(snap({ tick: 5, overLimit: true, bodies: [body({ x: 400, radius: 50, overLimit: true })] }));
    tr.onStep(snap({ tick: 6, overLimit: true, bodies: [body({ x: 400, radius: 50, overLimit: true })] }));
    const s = tr.finish();
    expect(s.episodeCount).toBe(1);
    const e = s.episodes[0]!;
    expect(e.endTick).toBeNull();
    expect(e.seconds).toBeCloseTo(2 / TICK_HZ, 9);
    expect(s.openAtEnd).toBe(true);
  });

  it('2 回はみ出すと 2 エピソード。firstOverSeconds は 1 回目のもの', () => {
    const tr = createOverTracker();
    const over = (tick: number) =>
      snap({ tick, overLimit: true, bodies: [body({ x: 330, radius: 20, overLimit: true })] });
    tr.onStep(over(10));
    tr.onStep(over(11));
    tr.onStep(snap({ tick: 12 }));
    tr.onStep(snap({ tick: 13 }));
    tr.onStep(over(14));
    tr.onStep(snap({ tick: 15 }));
    const s = tr.finish();
    expect(s.episodeCount).toBe(2);
    expect(s.firstOverSeconds).toBeCloseTo(10 / TICK_HZ, 9);
    expect(s.overSeconds).toBeCloseTo(3 / TICK_HZ, 9);
    // 秒数 [2/120, 1/120] の分布
    expect(s.episodeSeconds.median).toBeCloseTo(1.5 / TICK_HZ, 9);
    expect(s.episodeSeconds.max).toBeCloseTo(2 / TICK_HZ, 9);
  });

  it('一番深くはみ出た天体の方角・Tier・量が残る（あとで来た深い物に更新）', () => {
    const tr = createOverTracker();
    // 浅い方（外側の端 330 = 10px）と深い方（外側の端 410 = 90px、Tier 4、角 π）
    tr.onStep(
      snap({
        tick: 1,
        overLimit: true,
        bodies: [
          body({ id: 1, x: 300, radius: 30, overLimit: true }),
          body({ id: 2, x: -360, radius: 50, tier: 4, overLimit: true }),
        ],
      }),
    );
    const s = tr.finish();
    const e = s.episodes[0]!;
    expect(e.peakOverhangPx).toBeCloseTo(90, 9);
    expect(e.peakAngleRadians).toBeCloseTo(Math.PI, 9);
    expect(e.peakTier).toBe(4);
    expect(e.bodyCount).toBe(2);
  });

  it('エピソードの途中で別の天体がはみ出ても、1 エピソードのまま種類数だけ増える', () => {
    const tr = createOverTracker();
    tr.onStep(snap({ tick: 1, overLimit: true, bodies: [body({ id: 1, x: 330, radius: 20, overLimit: true })] }));
    tr.onStep(
      snap({
        tick: 2,
        overLimit: true,
        bodies: [
          body({ id: 1, x: 330, radius: 20, overLimit: true }),
          body({ id: 2, x: 340, radius: 20, overLimit: true }),
        ],
      }),
    );
    tr.onStep(snap({ tick: 3 }));
    const e = tr.finish().episodes[0]!;
    expect(e.bodyCount).toBe(2);
  });

  it('何も記録しなければ 0 エピソード・値は null/NaN', () => {
    const s = createOverTracker().finish();
    expect(s.ticks).toBe(0);
    expect(s.episodeCount).toBe(0);
    expect(s.episodes).toEqual([]);
    expect(s.overSeconds).toBe(0);
    expect(s.firstOverSeconds).toBeNull();
    expect(s.episodeSeconds.median).toBeNaN();
    expect(s.openAtEnd).toBe(false);
  });
});

describe('summarizeOverBatch', () => {
  it('回ごとの回数・率と、全エピソードの分布を出す', () => {
    const a = summary([ep({ seconds: 2, peakOverhangPx: 10, startTick: 240 }), ep({ seconds: 4, peakOverhangPx: 40, startTick: 600, endTick: null })]);
    const b = summary([ep({ seconds: 1, peakOverhangPx: 90, startTick: 120 })]);
    const c = summary([]); // はみ出さなかった回
    const s = summarizeOverBatch([a, b, c]);
    expect(s.runs).toBe(3);
    expect(s.overRate).toBeCloseTo(2 / 3, 9);
    // 回ごとの回数 [2, 1, 0] → 中央 1
    expect(s.episodeCount.median).toBe(1);
    // 初はみ出し秒は「はみ出した回」だけ: [2, 1] → 中央 1.5
    expect(s.firstOverSeconds.n).toBe(2);
    expect(s.firstOverSeconds.median).toBeCloseTo(1.5, 9);
    // エピソード秒は全部で [2, 4, 1] → 中央 2・最深はみ出し 90
    expect(s.episodeSeconds.median).toBe(2);
    expect(s.peakOverhang.max).toBe(90);
    // 3 エピソード中 2 つが閉じた
    expect(s.recoveredRate).toBeCloseTo(2 / 3, 9);
    // 3 回中 1 回が「越えたまま終了」
    expect(s.openAtEndRate).toBeCloseTo(1 / 3, 9);
  });

  it('空なら回数 0・値は NaN', () => {
    const s = summarizeOverBatch([]);
    expect(s.runs).toBe(0);
    expect(s.overRate).toBeNaN();
    expect(s.episodeCount.median).toBeNaN();
    expect(s.firstOverSeconds.median).toBeNaN();
    expect(s.recoveredRate).toBeNaN();
    expect(s.openAtEndRate).toBeNaN();
  });

  it('全部の回ではみ出さなければ、率は 0 で分布は NaN', () => {
    const s = summarizeOverBatch([summary([]), summary([])]);
    expect(s.overRate).toBe(0);
    expect(s.episodeCount.median).toBe(0);
    expect(s.firstOverSeconds.n).toBe(0);
    expect(s.firstOverSeconds.median).toBeNaN();
    expect(s.recoveredRate).toBeNaN();
    expect(s.openAtEndRate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 実シミュレーションで端から端まで

describe('実シミュレーションでの計測', () => {
  it('はみ出す山なら、猶予（1.2 秒）のあとでエピソードが始まり、越えたまま終わる', () => {
    const { result, summary } = measureOver(randomBot(1), { seed: 1, maxTicks: 30 * TICK_HZ, setup: PILE });
    // 熱量 95 開始なので 100 に達して終了（打ち切りではない）
    expect(result.timedOut).toBe(false);
    expect(summary.episodeCount).toBeGreaterThanOrEqual(1);
    // 猶予時間が終わるまではみ出しと判定されないので、初はみ出しは 1.2 秒以降
    expect(summary.firstOverSeconds).not.toBeNull();
    expect(summary.firstOverSeconds!).toBeGreaterThanOrEqual(1.19);
    // 越えたまま熱量が 100 に達したので、最後のエピソードは閉じない
    expect(summary.openAtEnd).toBe(true);
    expect(summary.episodes[summary.episodes.length - 1]!.endTick).toBeNull();
    // 越えていた合計時間は result の限界越え秒と一致する（同じ tick を数えている）
    expect(summary.overSeconds).toBeCloseTo(result.overLimitSeconds, 9);
    // 深くはみ出す山なので、最深はみ出しは十分に大きい
    expect(summary.peakOverhang.max).toBeGreaterThan(30);
  });

  it('ふつうの短いプレイなら 0 エピソード・越えた秒も 0', () => {
    const { result, summary } = measureOver(randomBot(3), { seed: 3, maxTicks: 10 * TICK_HZ });
    expect(result.overLimitSeconds).toBe(0);
    expect(summary.episodeCount).toBe(0);
    expect(summary.firstOverSeconds).toBeNull();
    expect(summary.openAtEnd).toBe(false);
    expect(summary.overSeconds).toBe(0);
    expect(summary.ticks).toBe(result.ticks);
  });

  it('ぎりぎりの山で遊んでも、閉じたエピソードは端点と秒数が整合する', () => {
    const { result, summary } = measureOver(mergeBot(2), { seed: 2, maxTicks: 30 * TICK_HZ, setup: MARGIN });
    for (const e of summary.episodes) {
      if (e.endTick === null) continue;
      // 閉じたエピソードは「開始 tick < 戻った tick」で、秒数はその間の長さ
      expect(e.endTick).toBeGreaterThan(e.startTick);
      expect(e.seconds).toBeCloseTo((e.endTick - e.startTick) / TICK_HZ, 9);
      expect(e.peakOverhangPx).toBeGreaterThan(0);
      expect(e.bodyCount).toBeGreaterThanOrEqual(1);
    }
    expect(summary.overSeconds).toBeCloseTo(result.overLimitSeconds, 9);
  });

  it('撃てないボットなら 0 エピソード（START_BODY だけでは届かない）', () => {
    const stubborn: Bot = { name: 'stubborn', decide: () => ({ originAngleRadians: 0, vx: 0, vy: 0 }) };
    const { result, summary } = measureOver(stubborn, { seed: 1, maxTicks: 10 * TICK_HZ });
    expect(result.launches).toBe(0);
    expect(summary.episodeCount).toBe(0);
  });

  it('決定的: 同じシードで 2 度測るとまとめは全く同じ', () => {
    const a = measureOver(mergeBot(7), { seed: 7, maxTicks: 10 * TICK_HZ });
    const b = measureOver(mergeBot(7), { seed: 7, maxTicks: 10 * TICK_HZ });
    expect(a.summary).toEqual(b.summary);
  });

  it('利用側の hooks も最後に呼ぶ（onStep も含む）', () => {
    let steps = 0;
    let launches = 0;
    const { result, summary } = measureOver(randomBot(2), {
      seed: 2,
      maxTicks: 5 * TICK_HZ,
      hooks: {
        onLaunch: () => launches++,
        onStep: () => steps++,
      },
    });
    expect(steps).toBe(result.ticks);
    expect(steps).toBe(summary.ticks);
    expect(launches).toBe(result.launches);
  });

  it('measureAccuracy の観察口に混ぜられる（1 まわしで両方取る形）', () => {
    const tracker = createOverTracker();
    const { shots, result } = measureAccuracy(randomBot(4), {
      seed: 4,
      maxTicks: 5 * TICK_HZ,
      hooks: { onStep: tracker.onStep },
    });
    expect(shots.length).toBe(result.launches);
    expect(tracker.finish().ticks).toBe(result.ticks);
  });
});

describe('measureOverBatch', () => {
  it('回ごとの結果とまとめ・合算を返す', () => {
    const m = measureOverBatch(randomBot, { runs: 2, seedStart: 10, maxTicks: 10 * TICK_HZ });
    expect(m.runs).toHaveLength(2);
    expect(m.summaries).toHaveLength(2);
    expect(m.summaries[0]!.ticks).toBe(m.runs[0]!.ticks);
    expect(m.summary.runs).toBe(2);
    // 同じ条件でまわし直しても同じ
    const again = measureOverBatch(randomBot, { runs: 2, seedStart: 10, maxTicks: 10 * TICK_HZ });
    expect(again.summary).toEqual(m.summary);
  });

  it('はみ出す条件なら率とエピソードが出る', () => {
    const m = measureOverBatch(randomBot, { runs: 2, seedStart: 5, maxTicks: 30 * TICK_HZ, setup: PILE });
    expect(m.summary.runs).toBe(2);
    expect(m.summary.overRate).toBe(1);
    expect(m.summary.episodeCount.min).toBeGreaterThanOrEqual(1);
    expect(m.summary.firstOverSeconds.min).toBeGreaterThanOrEqual(1.19);
    expect(m.summary.openAtEndRate).toBe(1);
  });

  it('0 回なら空を返す', () => {
    const m = measureOverBatch(randomBot, { runs: 0 });
    expect(m.runs).toEqual([]);
    expect(m.summaries).toEqual([]);
    expect(m.summary.runs).toBe(0);
  });
});
