// シードを変えて何回も自動で遊ばせ、結果を分布にまとめる。
// 「何分続いたか」「どこまで育ったか」を数字で見るための道具。全部決定的。

import type {
  BodyId,
  GameEvent,
  GameSnapshot,
  LaunchCommand,
  Prediction,
  SimulationPort,
  Tick,
} from '../contracts/game';
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
  /** 射出 1 回あたりの合体数（打つ効率）。0 射出なら 0 */
  mergesPerLaunch: number;
  supernovas: number;
  maxChain: number;
  /** 熱量が 75 を越えた回数（開始時にすで越えていれば 1。下がってまた越えたら +1） */
  heat75Count: number;
  /** このプレイで一度でも到達した最大の熱量。終わらなかった回でも「あとどれくらいで危なかったか」が分かる */
  peakHeat: number;
  /** 山が限界リングを越えていた合計時間（秒）。「どれだけ危ない状態だったか」の目安 */
  overLimitSeconds: number;
  /** 時間の上限に達して終えた（まだ終わっていなかった） */
  timedOut: boolean;
  /** このプレイに使った setup（replayLaunches で再現する時にそのまま渡せる） */
  setup?: SimulationSetup;
}>;

/**
 * プレイの途中を覗く口。結果を変えずに「どう進んだか」を記録する用。
 * accuracy.ts（予測の的中率の計測）で使う。
 */
export type PlayHooks = Readonly<{
  /**
   * 受理された射出 1 回ごとに呼ぶ。
   * prediction は撃つ直前の盤面で取ったもの（撃った後に predict すると、
   * 撃った天体自身に衝突する予測が返るので使い物にならない）。
   * snapshot は撃つ直前の盤面（decide が見たのと同じ。nextQueue[0] = 撃った天体の Tier）。
   */
  onLaunch?: (
    command: LaunchCommand,
    prediction: Prediction,
    bodyId: BodyId,
    tick: Tick,
    snapshot: GameSnapshot,
  ) => void;
  /** stepFixed が返したイベント（その tick に起きた分）。launch イベントもここに来る */
  onEvents?: (events: readonly GameEvent[]) => void;
}>;

export type PlayOptions = Readonly<{
  seed: number;
  /** これだけ tick が経過したら打ち切る。既定は 10 分ぶん */
  maxTicks?: number;
  /** 盤面・熱量・キューの初期値（createSimulation にそのまま渡す） */
  setup?: SimulationSetup;
  /** 観察用の口。省略すれば何も呼ばれない（予測も取らない） */
  hooks?: PlayHooks;
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
  let overLimitTicks = 0;
  let peakHeat = sim.getSnapshot().heat;
  let wasHot = sim.getSnapshot().heat > HEAT_HOT;
  // 開始時点ですで 75 を越えていたなら、それも「越えていた 1 回」と数える
  let heat75Count = wasHot ? 1 : 0;

  const step = (): void => {
    const events = sim.stepFixed();
    options.hooks?.onEvents?.(events);
    const s = sim.getSnapshot();
    if (s.overLimit) overLimitTicks++;
    if (s.heat > peakHeat) peakHeat = s.heat;
    if (s.heat > HEAT_HOT && !wasHot) heat75Count++;
    wasHot = s.heat > HEAT_HOT;
  };

  for (;;) {
    const snap = sim.getSnapshot();
    if (snap.phase !== 'active' || snap.tick >= maxTicks) break;
    if (snap.launchCooldownLeftSeconds <= 0) {
      const command = bot.decide(snap, (c) => sim.predict(c));
      const hook = options.hooks?.onLaunch;
      // 撃つ前に予測を取る（撃った後だと盤面に自分がいて、予測が自分に当たって壊れる）
      const predicted = hook === undefined ? undefined : sim.predict(command);
      const res = sim.submitLaunch(command);
      if (!res.accepted) {
        // 射出点が塞がっていた等。少し進めてからやり直す
        for (let i = 0; i < RETRY_WAIT_TICKS; i++) {
          if (sim.getSnapshot().phase !== 'active') break;
          step();
        }
        continue;
      }
      if (hook !== undefined && predicted !== undefined) hook(command, predicted, res.bodyId, snap.tick, snap);
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
      mergesPerLaunch: snap.stats.launches > 0 ? snap.stats.merges / snap.stats.launches : 0,
      supernovas: snap.stats.supernovas,
      maxChain: snap.stats.maxChain,
      heat75Count,
      peakHeat,
      overLimitSeconds: overLimitTicks / TICK_HZ,
      timedOut: snap.phase === 'active',
      setup: options.setup,
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
  'mergesPerLaunch',
  'maxChain',
  'heat75Count',
  'peakHeat',
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
