// シードを変えて何回も自動で遊ばせ、結果を分布にまとめる。
// 「何分続いたか」「どこまで育ったか」を数字で見るための道具。全部決定的。

import type { SimulationPort } from '../contracts/game';
import { HEAT_STATE_LIMITS, TICK_HZ } from '../game/constants';
import { createSimulation, type SimulationSetup } from '../game/simulation';
import { summarize, type Stats } from './stats';
import type { Bot, BotFactory } from './bots';

/** 「臨界」の境目 = 75。熱量がこれを越えた回数を数える（constants.ts の値をそのまま使う） */
const HEAT_HOT = HEAT_STATE_LIMITS[2];
/** 射出が断られた時に、どれだけ進めてからやり直すか */
const RETRY_WAIT_TICKS = 12;
/** 既定の上限: 10 分ぶん */
export const DEFAULT_MAX_TICKS = 10 * 60 * TICK_HZ;

/** 1 回のプレイのまとめ。 */
export type PlayResult = Readonly<{
  seed: number;
  /** 続いた時間（tick。120 = 1 秒） */
  ticks: number;
  seconds: number;
  score: number;
  bestTier: number;
  launches: number;
  merges: number;
  supernovas: number;
  maxChain: number;
  /** 熱量が 75 を越えた回数（下がってまた越えたら 2 回） */
  heat75Count: number;
  /** 山が限界リングを越えていた合計時間（秒）。「どれだけ危ない状態だったか」の目安 */
  overLimitSeconds: number;
  /** 時間の上限に達して終えた（まだ終わっていなかった） */
  timedOut: boolean;
}>;

export type PlayOptions = Readonly<{
  seed: number;
  /** これだけ tick が経過したら打ち切る。既定は 10 分ぶん */
  maxTicks?: number;
  /** 盤面・熱量・キューの初期値（createSimulation にそのまま渡す） */
  setup?: SimulationSetup;
}>;

export type PlayOutcome = Readonly<{
  result: PlayResult;
  /** 入力ログや最後の盤面を確かめたい時用に返す */
  sim: SimulationPort;
}>;

/**
 * ボットに 1 回遊ばせる。
 * 撃てる時は decide に聞いて撃ち、断られたら少し進めてやり直す。
 * 終了（phase が 'over'）か、時間の上限まで進む。
 */
export function playOnce(bot: Bot, options: PlayOptions): PlayOutcome {
  const maxTicks = options.maxTicks ?? DEFAULT_MAX_TICKS;
  const sim = createSimulation(options.seed, options.setup);
  let heat75Count = 0;
  let overLimitTicks = 0;
  let wasHot = sim.getSnapshot().heat > HEAT_HOT;

  const step = (): void => {
    sim.stepFixed();
    const s = sim.getSnapshot();
    if (s.overLimit) overLimitTicks++;
    if (s.heat > HEAT_HOT && !wasHot) heat75Count++;
    wasHot = s.heat > HEAT_HOT;
  };

  for (;;) {
    const snap = sim.getSnapshot();
    if (snap.phase !== 'active' || snap.tick >= maxTicks) break;
    if (snap.launchCooldownLeftSeconds <= 0) {
      const res = sim.submitLaunch(bot.decide(snap, (c) => sim.predict(c)));
      if (!res.accepted) {
        // 射出点が塞がっていた等。少し進めてからやり直す
        for (let i = 0; i < RETRY_WAIT_TICKS; i++) {
          if (sim.getSnapshot().phase !== 'active') break;
          step();
        }
        continue;
      }
    }
    step();
  }

  const snap = sim.getSnapshot();
  return {
    sim,
    result: {
      seed: options.seed,
      ticks: snap.tick,
      seconds: snap.tick / TICK_HZ,
      score: snap.score,
      bestTier: snap.bestTierThisRun,
      launches: snap.stats.launches,
      merges: snap.stats.merges,
      supernovas: snap.stats.supernovas,
      maxChain: snap.stats.maxChain,
      heat75Count,
      overLimitSeconds: overLimitTicks / TICK_HZ,
      timedOut: snap.phase === 'active',
    },
  };
}

export type BatchOptions = Readonly<{
  /** 回数 */
  runs: number;
  /** 最初のシード。i 番目は seedStart + i で遊ぶ */
  seedStart?: number;
  maxTicks?: number;
  setup?: SimulationSetup;
}>;

/** シードを変えて N 回遊ばせる。 */
export function runBatch(bot: BotFactory, options: BatchOptions): PlayResult[] {
  const seedStart = options.seedStart ?? 1;
  const results: PlayResult[] = [];
  for (let i = 0; i < options.runs; i++) {
    results.push(playOnce(bot(seedStart + i), { seed: seedStart + i, maxTicks: options.maxTicks, setup: options.setup }).result);
  }
  return results;
}

/** 分布に出す指標（PlayResult の数値キー）。 */
export const RUN_METRICS = [
  'seconds',
  'score',
  'bestTier',
  'merges',
  'maxChain',
  'heat75Count',
  'overLimitSeconds',
  'launches',
  'supernovas',
] as const;
export type RunMetric = (typeof RUN_METRICS)[number];

/** 各指標ごとに平均・中央値・10%・90% を出す。 */
export function summarizeRuns(runs: readonly PlayResult[]): Record<RunMetric, Stats> {
  const out = {} as Record<RunMetric, Stats>;
  for (const m of RUN_METRICS) out[m] = summarize(runs.map((r) => r[m]));
  return out;
}
