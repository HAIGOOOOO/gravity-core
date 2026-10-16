// 予測（predict）は「盤面が止まっている」前提で組まれる。
// 実際には合体・押し出し・着地で盤面が動くので、狙った合体が外れることがある。
// この道具は「射出ごとに、予測どおりにいったか」を記録して的中率を出す。
// ボットの合体数が実力よりどれだけ低く出ているか（＝ボットの数字の信頼度）の目安になる。
//
// 1 射の結末は、その天体について最初に起きたイベントで決める:
//   - land が出る前に合体イベントで消費された → 'merged'（最初の接触が合体。予測が見ている物）
//   - 先に land が出て、そのまま残った → 'landed'
//   - land のあと合体で消費された → 'landedThenMerged'（押し出し等による追加分。予測は見ない）
//   - 終了・打ち切りまで何も起きなかった → 'noContact'
//
// 判定はイベント（GameEvent）だけを見て行う:
//   - 'land' の bodyIds = 着地した天体
//   - 'merge' の bodyIds = [消えた 2 体, 生まれた子]（最後は消費でない）
//   - 'supernova' の bodyIds = [消えた 2 体]

import type {
  BodyId,
  GameEvent,
  LaunchCommand,
  Prediction,
  SimulationPort,
  Tick,
} from '../contracts/game';
import { playOnce, type BatchOptions, type PlayOptions, type PlayResult } from './batch';
import { summarize, type Stats } from './stats';
import type { Bot, BotFactory } from './bots';

/** 1 射の結末（最初に起きたイベントで決まる） */
export type ShotOutcome = 'merged' | 'landed' | 'landedThenMerged' | 'noContact';

/** 1 射の記録。 */
export type ShotRecord = Readonly<{
  seed: number;
  /** 撃った tick */
  tick: Tick;
  /** 撃って生まれた天体 */
  bodyId: BodyId;
  command: LaunchCommand;
  predictedEnd: Prediction['end'];
  predictedMerge: boolean;
  predictedHitBodyId: BodyId | null;
  /** 予測の道すじの最後の点（最初に触れる場所）。invalid 等で無ければ null */
  predictedPoint: { x: number; y: number } | null;
  outcome: ShotOutcome;
  /** 着地した場所（landed / landedThenMerged の時） */
  landPoint: { x: number; y: number } | null;
  /** 合体で消えた時の相手（自分を除く消費された側。子は含まない） */
  mergePartners: readonly BodyId[];
  mergeTick: Tick | null;
}>;

// 追跡中の内部形（イベントが来るたびに書き換える）
type MutableShot = {
  seed: number;
  tick: Tick;
  bodyId: BodyId;
  command: LaunchCommand;
  predictedEnd: Prediction['end'];
  predictedMerge: boolean;
  predictedHitBodyId: BodyId | null;
  predictedPoint: { x: number; y: number } | null;
  landed: boolean;
  landPoint: { x: number; y: number } | null;
  merged: boolean;
  mergePartners: BodyId[];
  mergeTick: Tick | null;
};

/**
 * 射出とイベントを食わせて結末を追跡する器。
 * 使い方: 受理された射出ごとに beginShot、各 tick のイベントを handleEvent、
 * プレイの終わりに finish で記録を取り出す。
 */
export function createAccuracyTracker(seed: number): {
  beginShot(tick: Tick, command: LaunchCommand, prediction: Prediction, bodyId: BodyId): void;
  handleEvent(event: GameEvent): void;
  finish(): ShotRecord[];
} {
  const shots: MutableShot[] = [];
  const byBody = new Map<BodyId, MutableShot>();
  return {
    beginShot(tick, command, prediction, bodyId) {
      const last = prediction.points[prediction.points.length - 1];
      const shot: MutableShot = {
        seed,
        tick,
        bodyId,
        command,
        predictedEnd: prediction.end,
        predictedMerge: prediction.willMerge,
        predictedHitBodyId: prediction.hitBodyId,
        predictedPoint: last ? { x: last.x, y: last.y } : null,
        landed: false,
        landPoint: null,
        merged: false,
        mergePartners: [],
        mergeTick: null,
      };
      shots.push(shot);
      byBody.set(bodyId, shot);
    },
    handleEvent(e) {
      const ids = e.bodyIds;
      if (ids === undefined) return;
      if (e.kind === 'land') {
        for (const id of ids) {
          const s = byBody.get(id);
          if (s !== undefined && !s.landed && !s.merged) {
            s.landed = true;
            s.landPoint = e.x !== undefined && e.y !== undefined ? { x: e.x, y: e.y } : null;
          }
        }
        return;
      }
      if (e.kind === 'merge' || e.kind === 'supernova') {
        // merge の bodyIds の末尾は生まれた子（消費ではない）。3 件未満なら全部消費として扱う
        const consumed = e.kind === 'merge' && ids.length >= 3 ? ids.slice(0, -1) : ids;
        for (const id of consumed) {
          const s = byBody.get(id);
          if (s !== undefined && !s.merged) {
            s.merged = true;
            s.mergeTick = e.tick;
            s.mergePartners = consumed.filter((other) => other !== id);
          }
        }
      }
    },
    finish() {
      return shots.map((s) => ({
        seed: s.seed,
        tick: s.tick,
        bodyId: s.bodyId,
        command: s.command,
        predictedEnd: s.predictedEnd,
        predictedMerge: s.predictedMerge,
        predictedHitBodyId: s.predictedHitBodyId,
        predictedPoint: s.predictedPoint,
        outcome: s.merged
          ? s.landed
            ? ('landedThenMerged' as const)
            : ('merged' as const)
          : s.landed
            ? ('landed' as const)
            : ('noContact' as const),
        landPoint: s.landPoint,
        mergePartners: s.mergePartners,
        mergeTick: s.mergeTick,
      }));
    },
  };
}

/** まとめた的中率。 */
export type AccuracySummary = Readonly<{
  /** 受理された射出の数 */
  shots: number;
  /** 「合体する」と予測された射出の数 */
  predictedMerges: number;
  /** 予測どおり、最初の接触が合体だった数 */
  mergeHits: number;
  /** mergeHits / predictedMerges（予測合体が無ければ NaN） */
  mergeHitRate: number;
  /** 合体すると予測されたのに最初の接触が合体でなかった数（着地 or 未接触） */
  mergeMisses: number;
  /** 最初の接触が合体だった射出の合計（的中 + 予測外） */
  actualMerges: number;
  /** 予測していないのに最初の接触が合体だった数（動いた盤面で偶然当たった等） */
  surpriseMerges: number;
  /** 着地したあと合体に消費された数（押し出し等の追加分） */
  landedThenMerged: number;
  /** 終了・打ち切りまで接触しなかった数 */
  noContact: number;
  /** 'merged' のうち、実際に合体した相手が予測の相手と同じだった率（相手不明の射出は母数に入れない） */
  partnerMatchRate: number;
  /** 着地位置と予測の最後の点との距離（px）の分布。着地した & 予測点のある射出だけ */
  landError: Stats;
}>;

/** 記録を集計する。空なら率は NaN。 */
export function summarizeAccuracy(shots: readonly ShotRecord[]): AccuracySummary {
  let predictedMerges = 0;
  let mergeHits = 0;
  let actualMerges = 0;
  let surpriseMerges = 0;
  let landedThenMerged = 0;
  let noContact = 0;
  let partnerChecked = 0;
  let partnerMatch = 0;
  const landErrors: number[] = [];
  for (const s of shots) {
    if (s.predictedMerge) {
      predictedMerges++;
      if (s.outcome === 'merged') mergeHits++;
    }
    if (s.outcome === 'merged') {
      actualMerges++;
      if (!s.predictedMerge) surpriseMerges++;
      if (s.predictedHitBodyId !== null) {
        partnerChecked++;
        if (s.mergePartners.includes(s.predictedHitBodyId)) partnerMatch++;
      }
    }
    if (s.outcome === 'landedThenMerged') landedThenMerged++;
    if (s.outcome === 'noContact') noContact++;
    if (s.landPoint !== null && s.predictedPoint !== null) {
      landErrors.push(Math.hypot(s.landPoint.x - s.predictedPoint.x, s.landPoint.y - s.predictedPoint.y));
    }
  }
  return {
    shots: shots.length,
    predictedMerges,
    mergeHits,
    mergeHitRate: predictedMerges > 0 ? mergeHits / predictedMerges : NaN,
    mergeMisses: predictedMerges - mergeHits,
    actualMerges,
    surpriseMerges,
    landedThenMerged,
    noContact,
    partnerMatchRate: partnerChecked > 0 ? partnerMatch / partnerChecked : NaN,
    landError: summarize(landErrors),
  };
}

export type AccuracyOutcome = Readonly<{
  result: PlayResult;
  sim: SimulationPort;
  shots: ShotRecord[];
  summary: AccuracySummary;
}>;

/**
 * ボットに 1 回遊ばせながら、全部の射出について予測と結末を記録する。
 * playOnce と同じ進め方（setup もそのまま使える）。利用側が渡した hooks も最後に呼ぶ。
 */
export function measureAccuracy(bot: Bot, options: PlayOptions): AccuracyOutcome {
  const tracker = createAccuracyTracker(options.seed);
  const { result, sim } = playOnce(bot, {
    ...options,
    hooks: {
      onLaunch: (command, prediction, bodyId, tick) => {
        tracker.beginShot(tick, command, prediction, bodyId);
        options.hooks?.onLaunch?.(command, prediction, bodyId, tick);
      },
      onEvents: (events) => {
        for (const e of events) tracker.handleEvent(e);
        options.hooks?.onEvents?.(events);
      },
    },
  });
  const shots = tracker.finish();
  return { result, sim, shots, summary: summarizeAccuracy(shots) };
}

export type AccuracyBatch = Readonly<{
  runs: PlayResult[];
  /** 全部の回の射出をまとめた物（seed で区別できる） */
  shots: ShotRecord[];
  summary: AccuracySummary;
}>;

/** シードを変えて N 回遊ばせ、結果と的中率を同時に取る（まわし直し不要）。 */
export function measureAccuracyBatch(make: BotFactory, options: BatchOptions): AccuracyBatch {
  const seedStart = options.seedStart ?? 1;
  const runs: PlayResult[] = [];
  const shots: ShotRecord[] = [];
  for (let i = 0; i < options.runs; i++) {
    const out = measureAccuracy(make(seedStart + i), {
      seed: seedStart + i,
      maxTicks: options.maxTicks,
      setup: options.setup,
    });
    runs.push(out.result);
    shots.push(...out.shots);
  }
  return { runs, shots, summary: summarizeAccuracy(shots) };
}
