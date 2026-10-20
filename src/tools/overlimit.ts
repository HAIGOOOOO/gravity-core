// 山が限界リングを越えた「はみ出しエピソード」を 1 回ずつ記録する。
// board.ts が「全 tick の滞在率・詰まり具合」を出すのに対し、
// こちらは「はみ出し→戻り」の 1 回 1 回を区別する:
//   - 何回はみ出したか（エピソード数）
//   - いつ最初にはみ出したか（序盤から危ないのか、終盤に崩れたのか）
//   - 一番深くどれだけはみ出したか・どの方角の山が危なかったか
//   - はみ出しても山が戻れたか、それとも越えたまま終わったか
// HEAT_RISE_PER_SECOND / LIMIT_GRACE_SECONDS / LIMIT_RADIUS の調整の基本の数字。
//
// 記録は onStep フックに渡ってくる盤面（GameSnapshot）だけを見て行う:
//   - snapshot.overLimit が false→true でエピソード開始、true→false で終了
//   - はみ出しの深さ = はみ出ている天体（b.overLimit）の「外側の端 − LIMIT_RADIUS」の最大値

import type { BodyId, GameSnapshot, SimulationPort, Tick, Tier } from '../contracts/game';
import { LIMIT_RADIUS, TICK_HZ } from '../game/constants';
import { playOnce, type BatchOptions, type PlayOptions, type PlayResult } from './batch';
import type { Bot, BotFactory } from './bots';
import { summarize, type Stats } from './stats';

/** はみ出し 1 回分。startTick から endTick まで snapshot.overLimit が true だった連続した区間。 */
export type OverEpisode = Readonly<{
  /** はみ出していると最初に観測した tick */
  startTick: Tick;
  /** 戻ったと最初に観測した tick（終了・打ち切りではみ出したままなら null） */
  endTick: Tick | null;
  /** はみ出していた秒数 */
  seconds: number;
  /** 一番深くはみ出した量（天体の外側の端 − LIMIT_RADIUS の最大値。px） */
  peakOverhangPx: number;
  /** 一番深くはみ出した天体の方角（ラジアン。「どの方角の山が危なかったか」） */
  peakAngleRadians: number;
  /** 一番深くはみ出した天体の Tier */
  peakTier: Tier;
  /** エピソード中に一度でもはみ出た天体の数（id の種類数） */
  bodyCount: number;
}>;

/** 1 回のプレイのはみ出しまとめ。 */
export type OverSummary = Readonly<{
  /** 記録した tick 数（= result.ticks） */
  ticks: number;
  /** はみ出しの個票（起きた順） */
  episodes: readonly OverEpisode[];
  /** はみ出しの回数 */
  episodeCount: number;
  /** はみ出していた合計秒数（result.overLimitSeconds と同じはず。確かめる用にも残す） */
  overSeconds: number;
  /** 最初のはみ出しが始まった秒（一度も無ければ null） */
  firstOverSeconds: number | null;
  /** 全部のエピソードの秒数の分布 */
  episodeSeconds: Stats;
  /** エピソードごとの最深はみ出し px の分布 */
  peakOverhang: Stats;
  /** 終わる時点ではみ出したままだった（打ち切りなら「打ち切り時点で危険」、終了なら「その山で終わった」） */
  openAtEnd: boolean;
}>;

// 追跡中の内部形（盤面が来るたびに書き換える）
type MutableEpisode = {
  startTick: Tick;
  endTick: Tick | null;
  ticks: number;
  peakOverhangPx: number;
  peakAngleRadians: number;
  peakTier: Tier;
  bodyIds: Set<BodyId>;
};

/**
 * 各 tick の盤面を食わせてエピソードを記録する器。
 * 使い方: playOnce や measureAccuracy の hooks.onStep に onStep を渡し、終わったら finish。
 */
export function createOverTracker(): {
  onStep(snapshot: GameSnapshot): void;
  finish(): OverSummary;
} {
  let ticks = 0;
  let open: MutableEpisode | null = null;
  const done: OverEpisode[] = [];

  /** 追跡中の内部形を、外に出す読み取り専用に写す */
  const freeze = (ep: MutableEpisode): OverEpisode => ({
    startTick: ep.startTick,
    endTick: ep.endTick,
    seconds: ep.ticks / TICK_HZ,
    peakOverhangPx: ep.peakOverhangPx,
    peakAngleRadians: ep.peakAngleRadians,
    peakTier: ep.peakTier,
    bodyCount: ep.bodyIds.size,
  });

  return {
    onStep(s) {
      ticks++;
      if (s.overLimit) {
        if (open === null) {
          open = {
            startTick: s.tick,
            endTick: null,
            ticks: 0,
            peakOverhangPx: 0,
            peakAngleRadians: 0,
            peakTier: 0,
            bodyIds: new Set<BodyId>(),
          };
        }
        open.ticks++;
        for (const b of s.bodies) {
          if (!b.overLimit) continue;
          open.bodyIds.add(b.id);
          const overhang = Math.hypot(b.x, b.y) + b.radius - LIMIT_RADIUS;
          if (overhang > open.peakOverhangPx) {
            open.peakOverhangPx = overhang;
            open.peakAngleRadians = Math.atan2(b.y, b.x);
            open.peakTier = b.tier;
          }
        }
      } else if (open !== null) {
        open.endTick = s.tick;
        done.push(freeze(open));
        open = null;
      }
    },
    finish() {
      // 終了・打ち切りではみ出したままなら、endTick 無しのまま締める
      const episodes = open !== null ? [...done, freeze(open)] : done;
      return {
        ticks,
        episodes,
        episodeCount: episodes.length,
        overSeconds: episodes.reduce((sum, e) => sum + e.seconds, 0),
        firstOverSeconds: episodes.length > 0 ? episodes[0]!.startTick / TICK_HZ : null,
        episodeSeconds: summarize(episodes.map((e) => e.seconds)),
        peakOverhang: summarize(episodes.map((e) => e.peakOverhangPx)),
        openAtEnd: open !== null,
      };
    },
  };
}

export type OverOutcome = Readonly<{
  result: PlayResult;
  sim: SimulationPort;
  summary: OverSummary;
}>;

/**
 * ボットに 1 回遊ばせながら、はみ出しエピソードを記録する。
 * 予測は取らないので measureAccuracy より軽い。利用側が渡した hooks も最後に呼ぶ。
 */
export function measureOver(bot: Bot, options: PlayOptions): OverOutcome {
  const tracker = createOverTracker();
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

/** N 回分のはみ出しまとめを、ボットどうしを比べる形にした物。 */
export type OverBatchSummary = Readonly<{
  runs: number;
  /** はみ出しが 1 回でもあった回の割合（0〜1。0 回なら NaN） */
  overRate: number;
  /** 回ごとのはみ出し回数の分布 */
  episodeCount: Stats;
  /** はみ出した回だけの「最初のはみ出し秒」の分布（危険が来るのは序盤か終盤か） */
  firstOverSeconds: Stats;
  /** 全回・全エピソードの秒数の分布（戻れない長さか、一瞬のはみ出しか） */
  episodeSeconds: Stats;
  /** エピソードごとの最深はみ出し px の分布 */
  peakOverhang: Stats;
  /** 閉じたエピソードの割合（はみ出しても山が戻った率。0 件なら NaN） */
  recoveredRate: number;
  /** 終わる時点ではみ出したままだった回の割合 */
  openAtEndRate: number;
}>;

/** 全部の回をまとめて、はみ出しエピソードの分布を出す。 */
export function summarizeOverBatch(summaries: readonly OverSummary[]): OverBatchSummary {
  const all = summaries.flatMap((s) => s.episodes);
  const withOver = summaries.filter((s) => s.episodeCount > 0);
  const closed = all.filter((e) => e.endTick !== null);
  return {
    runs: summaries.length,
    overRate: summaries.length > 0 ? withOver.length / summaries.length : NaN,
    episodeCount: summarize(summaries.map((s) => s.episodeCount)),
    firstOverSeconds: summarize(withOver.map((s) => s.firstOverSeconds!)),
    episodeSeconds: summarize(all.map((e) => e.seconds)),
    peakOverhang: summarize(all.map((e) => e.peakOverhangPx)),
    recoveredRate: all.length > 0 ? closed.length / all.length : NaN,
    openAtEndRate: summaries.length > 0 ? summaries.filter((s) => s.openAtEnd).length / summaries.length : NaN,
  };
}

export type OverBatch = Readonly<{
  runs: PlayResult[];
  /** 回ごとのまとめ（runs と同じ順。回の区別は result.seed で） */
  summaries: OverSummary[];
  /** 全部の回をまとめた物（overTable にはこちらを渡す） */
  summary: OverBatchSummary;
}>;

/** シードを変えて N 回遊ばせ、結果とはみ出しの記録を同時に取る。 */
export function measureOverBatch(make: BotFactory, options: BatchOptions): OverBatch {
  const seedStart = options.seedStart ?? 1;
  const runs: PlayResult[] = [];
  const summaries: OverSummary[] = [];
  for (let i = 0; i < options.runs; i++) {
    const out = measureOver(make(seedStart + i), {
      seed: seedStart + i,
      maxTicks: options.maxTicks,
      setup: options.setup,
    });
    runs.push(out.result);
    summaries.push(out.summary);
  }
  return { runs, summaries, summary: summarizeOverBatch(summaries) };
}
