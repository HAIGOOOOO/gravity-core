// 「どこまで育つか」の時間軸: Tier ごとに「最初にその Tier の天体が盤面に現れた時刻」を記録する。
// result.bestTier（最終到達）だけだと「じわじわ育った」のか「序盤に一気に育って守った」のか
// 分からない。合体が早すぎると盤面がすぐ大きい天体だらけになり、遅すぎると単調になるので、
// 「何秒で Tier N に着くか」は数値調整の基本の数字になる。
//
// 記録はイベントだけを見て決める:
//   - 開始時に盤面にある天体（setup.bodies、無ければ START_BODY）→ 0 秒で到達
//   - launch イベントの sourceTier → 撃った tick で到達（キューが高い Tier を出した場合）
//   - merge イベントの resultTier → 合体した tick で到達
//   - supernova は新しい天体を生まないので見ない（land の sourceTier は launch 済みなので不要）
//
// 「キューから出た高い Tier」や「setup で置いた天体」も到達に数える点が
// snapshot.bestTierThisRun（合体で作った Tier だけを数える）とは違うので注意。

import type { GameEvent, SimulationPort, Tick, Tier } from '../contracts/game';
import { START_BODY, TICK_HZ, TIER_COUNT } from '../game/constants';
import type { SimulationSetup } from '../game/simulation';
import { playOnce, type BatchOptions, type PlayOptions, type PlayResult } from './batch';
import type { Bot, BotFactory } from './bots';
import { summarize, type Stats } from './stats';

/** 1 回のプレイの「Tier ごとの初到達」。index = tier。届かなければ null。 */
export type TierPace = Readonly<{
  seed: number;
  reachTicks: readonly (Tick | null)[];
  /** 同じ物を秒にした物（表や分布にはこちらを使う） */
  reachSeconds: readonly (number | null)[];
}>;

/** 初到達 tick の並びから TierPace を作る。 */
export function tierPace(seed: number, reachTicks: readonly (Tick | null)[]): TierPace {
  return {
    seed,
    reachTicks,
    reachSeconds: reachTicks.map((t) => (t === null ? null : t / TICK_HZ)),
  };
}

/**
 * 「開始時点で盤面にある天体の Tier」の一覧（createPaceTracker に渡す用）。
 * setup.bodies があるならその Tier たち、無ければシミュレーションが置く START_BODY。
 */
export function setupTiers(setup: SimulationSetup | undefined): Tier[] {
  if (setup?.bodies !== undefined) return setup.bodies.map((b) => b.tier);
  return [START_BODY.tier];
}

/**
 * イベントを食わせて Tier ごとの初到達 tick を追跡する器。
 * initialTiers には setupTiers(setup) の結果を渡す（それらは tick 0 で到達扱い）。
 * 使い方: 各 tick のイベントを handleEvent、プレイの終わりに finish で取り出す。
 * measureAccuracy の観察口に混ぜれば、1 まわしで的中率と育ち方の両方が取れる。
 */
export function createPaceTracker(initialTiers: readonly Tier[] = []): {
  handleEvent(event: GameEvent): void;
  /** index = tier の初到達 tick（届かなければ null） */
  finish(): readonly (Tick | null)[];
} {
  const reach: (Tick | null)[] = new Array<Tick | null>(TIER_COUNT).fill(null);
  const mark = (tier: number, tick: Tick): void => {
    if (tier >= 0 && tier < TIER_COUNT && reach[tier] === null) reach[tier] = tick;
  };
  for (const t of initialTiers) mark(t, 0);
  return {
    handleEvent(e) {
      if (e.kind === 'launch' && e.sourceTier !== undefined) mark(e.sourceTier, e.tick);
      else if (e.kind === 'merge' && e.resultTier !== undefined) mark(e.resultTier, e.tick);
    },
    finish: () => [...reach],
  };
}

export type PaceOutcome = Readonly<{
  result: PlayResult;
  sim: SimulationPort;
  pace: TierPace;
}>;

/**
 * ボットに 1 回遊ばせながら、Tier ごとの初到達を記録する。
 * 予測は取らない（onLaunch を使わない）ので measureAccuracy より軽い。
 * 利用側が渡した hooks も最後に呼ぶ。
 */
export function measurePace(bot: Bot, options: PlayOptions): PaceOutcome {
  const tracker = createPaceTracker(setupTiers(options.setup));
  const { result, sim } = playOnce(bot, {
    ...options,
    hooks: {
      onLaunch: options.hooks?.onLaunch,
      onEvents: (events) => {
        for (const e of events) tracker.handleEvent(e);
        options.hooks?.onEvents?.(events);
      },
    },
  });
  return { result, sim, pace: tierPace(options.seed, tracker.finish()) };
}

export type PaceBatch = Readonly<{
  runs: PlayResult[];
  /** 回ごとの Tier ごとの初到達（seed で区別できる） */
  paces: TierPace[];
}>;

/** シードを変えて N 回遊ばせ、結果と Tier の育ち方を同時に取る。 */
export function measurePaceBatch(make: BotFactory, options: BatchOptions): PaceBatch {
  const seedStart = options.seedStart ?? 1;
  const runs: PlayResult[] = [];
  const paces: TierPace[] = [];
  for (let i = 0; i < options.runs; i++) {
    const out = measurePace(make(seedStart + i), {
      seed: seedStart + i,
      maxTicks: options.maxTicks,
      setup: options.setup,
    });
    runs.push(out.result);
    paces.push(out.pace);
  }
  return { runs, paces };
}

/** Tier ごとの育ち方のまとめ。 */
export type TierPaceStats = Readonly<{
  tier: Tier;
  /** 到達したプレイの割合（0〜1）。paces が空なら NaN */
  reachRate: number;
  /** 到達したプレイだけの初到達秒の分布（n = 到達した数） */
  seconds: Stats;
}>;

/**
 * 全部の回をまとめて、Tier ごとの「届いた率」と「何秒で届いたか」の分布を出す。
 * 行は必ず TIER_COUNT 個: 届かなかった Tier も「0%」で出す方が、
 * どこで育ちが止まるか（壁）が一目で分かる。
 */
export function summarizePace(paces: readonly TierPace[]): readonly TierPaceStats[] {
  const out: TierPaceStats[] = [];
  for (let tier = 0; tier < TIER_COUNT; tier++) {
    const reached: number[] = [];
    for (const p of paces) {
      const s = p.reachSeconds[tier];
      if (s !== null && s !== undefined) reached.push(s);
    }
    out.push({
      tier: tier as Tier,
      reachRate: paces.length > 0 ? reached.length / paces.length : NaN,
      seconds: summarize(reached),
    });
  }
  return out;
}
