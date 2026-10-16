// 盤面が「どれだけ詰まって、どれだけ熱かったか」を tick ごとに記録する。
// result の peakHeat や限界越え秒だけだと「ずっとギリギリだった」のか
// 「終盤だけ一気に詰まった」のか分からない。詰まり具合と熱の滞在は、
// TIER_RADIUS・LIMIT_RADIUS・HEAT_RISE/COOL の調整の基本の数字になる。
//
// 記録は onStep フックに渡ってくる盤面だけを見て行う（シミュレーションの中身は覗かない）。

import type { GameSnapshot, SimulationPort } from '../contracts/game';
import { HEAT_STATE_LIMITS, LIMIT_RADIUS, TICK_HZ } from '../game/constants';
import { playOnce, type BatchOptions, type PlayOptions, type PlayResult } from './batch';
import type { Bot, BotFactory } from './bots';
import { summarize, type Stats } from './stats';

/** 熱量の帯の数（安定 | 上昇 | 過熱 | 臨界 = 境目の数 + 1） */
export const HEAT_BAND_COUNT = HEAT_STATE_LIMITS.length + 1;

/**
 * 熱量を帯（0=安定 1=上昇 2=過熱 3=臨界）に分ける。
 * 境目の値は下の帯に入れる: batch.ts の heat75Count と揃えて「75 ぴったりはまだ臨界でない」。
 */
export function heatBand(heat: number): number {
  let band = 0;
  for (const limit of HEAT_STATE_LIMITS) if (heat > limit) band++;
  return band;
}

/** 1 回のプレイの盤面まとめ。 */
export type BoardSummary = Readonly<{
  /** 記録した tick 数（= result.ticks） */
  ticks: number;
  /** 記録した秒数（= result.seconds） */
  seconds: number;
  /** 各 tick の天体数の分布（max = 一番詰まった瞬間の天体数） */
  bodies: Stats;
  /**
   * 天体の面積の合計 ÷ 限界リングの面積（Σr² / LIMIT_RADIUS²）の分布。
   * π は両側で消える。1 を越えると物理的にリングをはみ出している。
   */
  fillRatio: Stats;
  /** 限界リングを越えていた tick の割合（0〜1） */
  overLimitRate: number;
  /** 各熱量帯にいた秒数（index = 帯。合計は seconds と同じ） */
  heatBandSeconds: readonly number[];
  /**
   * 熱量が初めて「臨界」（境目の一番上 = 75 超）に入った秒。
   * 入らなければ null。「危険域に届くのは序盤か終盤か」を見る。
   */
  firstHotSeconds: number | null;
  /**
   * 終わった tick の天体数・占有率・熱量（記録が無ければ null）。
   * peakHeat（途中の最高値）とは別に終わった瞬間を見る:
   * 「一度危なくて持ち直した」（終了時は低い）のか「危ないまま終わった」のかを分ける。
   * 打ち切りの回では「まだ余裕があったか」= 上限を伸ばせるかの目安にもなる。
   */
  endBodies: number | null;
  endFillRatio: number | null;
  endHeat: number | null;
}>;

/**
 * 各 tick の盤面を食わせてまとめる器。
 * 使い方: playOnce や measureAccuracy の hooks.onStep に onStep を渡し、終わったら finish。
 */
export function createBoardTracker(): {
  onStep(snapshot: GameSnapshot): void;
  finish(): BoardSummary;
} {
  let ticks = 0;
  let overLimitTicks = 0;
  const bodies: number[] = [];
  const fills: number[] = [];
  const bands: number[] = new Array<number>(HEAT_BAND_COUNT).fill(0);
  let firstHotTick: number | null = null;
  let lastBodies = 0;
  let lastFill = 0;
  let lastHeat = 0;
  return {
    onStep(s) {
      ticks++;
      if (s.overLimit) overLimitTicks++;
      bodies.push(s.bodies.length);
      let area = 0;
      for (const b of s.bodies) area += b.radius * b.radius;
      const fill = area / (LIMIT_RADIUS * LIMIT_RADIUS);
      fills.push(fill);
      const band = heatBand(s.heat);
      bands[band] += 1;
      if (firstHotTick === null && band === HEAT_BAND_COUNT - 1) firstHotTick = s.tick;
      lastBodies = s.bodies.length;
      lastFill = fill;
      lastHeat = s.heat;
    },
    finish() {
      return {
        ticks,
        seconds: ticks / TICK_HZ,
        bodies: summarize(bodies),
        fillRatio: summarize(fills),
        overLimitRate: ticks > 0 ? overLimitTicks / ticks : NaN,
        heatBandSeconds: bands.map((t) => t / TICK_HZ),
        firstHotSeconds: firstHotTick === null ? null : firstHotTick / TICK_HZ,
        endBodies: ticks > 0 ? lastBodies : null,
        endFillRatio: ticks > 0 ? lastFill : null,
        endHeat: ticks > 0 ? lastHeat : null,
      };
    },
  };
}

export type BoardOutcome = Readonly<{
  result: PlayResult;
  sim: SimulationPort;
  summary: BoardSummary;
}>;

/**
 * ボットに 1 回遊ばせながら、盤面の詰まりと熱の滞在を記録する。
 * 予測は取らないので measureAccuracy より軽い。利用側が渡した hooks も最後に呼ぶ。
 */
export function measureBoard(bot: Bot, options: PlayOptions): BoardOutcome {
  const tracker = createBoardTracker();
  const { result, sim } = playOnce(bot, {
    ...options,
    hooks: {
      onLaunch: options.hooks?.onLaunch,
      onEvents: options.hooks?.onEvents,
      onStep: (s) => {
        tracker.onStep(s);
        options.hooks?.onStep?.(s);
      },
    },
  });
  return { result, sim, summary: tracker.finish() };
}

/** N 回分の盤面まとめを、ボットどうしを比べる形にした物。 */
export type BoardBatchSummary = Readonly<{
  runs: number;
  /** 「一番詰まった瞬間」の天体数の分布（回ごとの bodies.max を分布にした物） */
  peakBodies: Stats;
  /** 「一番詰まった瞬間」の占有率の分布（回ごとの fillRatio.max） */
  peakFill: Stats;
  /** ふだんの天体数の分布（回ごとの中央値） */
  usualBodies: Stats;
  /** ふだんの占有率の分布（回ごとの中央値） */
  usualFill: Stats;
  /** 全回・全 tick を合わせた各熱量帯の割合（合計 1。長い回の分だけ重く数える） */
  heatBandRate: readonly number[];
  /** 回ごとの限界越え率の分布 */
  overLimitRate: Stats;
  /** 「臨界」に一度でも入った回だけの「入った秒」の分布（危険域に届くのが序盤か終盤か） */
  firstHotSeconds: Stats;
  /** 「臨界」に一度でも入った回の割合（0〜1。0 回なら NaN） */
  hotRate: number;
  /** 終わった瞬間の天体数・占有率・熱量の回ごとの分布（記録の無い回は外す） */
  endBodies: Stats;
  endFillRatio: Stats;
  endHeat: Stats;
}>;

/**
 * 全部の回をまとめて、「詰まり具合」と「熱の滞在」を出す。
 * 一番詰まった瞬間とふだんの両方を見る: 最大だけ高くて中央が低いなら、
 * 「平たい盤面が終盤に急に伸びて終わる」型の崩れ方をしている。
 */
export function summarizeBoardBatch(summaries: readonly BoardSummary[]): BoardBatchSummary {
  const bands: number[] = new Array<number>(HEAT_BAND_COUNT).fill(0);
  let totalSeconds = 0;
  for (const s of summaries) {
    totalSeconds += s.seconds;
    for (let i = 0; i < HEAT_BAND_COUNT; i++) bands[i] += s.heatBandSeconds[i] ?? 0;
  }
  const nonNull = (v: number | null): number[] => (v === null ? [] : [v]);
  const firsts = summaries.flatMap((s) => nonNull(s.firstHotSeconds));
  return {
    runs: summaries.length,
    peakBodies: summarize(summaries.map((s) => s.bodies.max)),
    peakFill: summarize(summaries.map((s) => s.fillRatio.max)),
    usualBodies: summarize(summaries.map((s) => s.bodies.median)),
    usualFill: summarize(summaries.map((s) => s.fillRatio.median)),
    heatBandRate: bands.map((t) => (totalSeconds > 0 ? t / totalSeconds : NaN)),
    overLimitRate: summarize(summaries.map((s) => s.overLimitRate)),
    firstHotSeconds: summarize(firsts),
    hotRate: summaries.length > 0 ? firsts.length / summaries.length : NaN,
    endBodies: summarize(summaries.flatMap((s) => nonNull(s.endBodies))),
    endFillRatio: summarize(summaries.flatMap((s) => nonNull(s.endFillRatio))),
    endHeat: summarize(summaries.flatMap((s) => nonNull(s.endHeat))),
  };
}

export type BoardBatch = Readonly<{
  runs: PlayResult[];
  /** 回ごとのまとめ（runs と同じ順。回の区別は result.seed で） */
  summaries: BoardSummary[];
  /** 全部の回をまとめた物（boardTable にはこちらを渡す） */
  summary: BoardBatchSummary;
}>;

/** シードを変えて N 回遊ばせ、結果と盤面の記録を同時に取る。 */
export function measureBoardBatch(make: BotFactory, options: BatchOptions): BoardBatch {
  const seedStart = options.seedStart ?? 1;
  const runs: PlayResult[] = [];
  const summaries: BoardSummary[] = [];
  for (let i = 0; i < options.runs; i++) {
    const out = measureBoard(make(seedStart + i), {
      seed: seedStart + i,
      maxTicks: options.maxTicks,
      setup: options.setup,
    });
    runs.push(out.result);
    summaries.push(out.summary);
  }
  return { runs, summaries, summary: summarizeBoardBatch(summaries) };
}
