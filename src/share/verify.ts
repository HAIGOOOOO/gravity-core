// 共有文字列を受け取り、シミュレーションで最初から再生して結果を計算し直す。
// 文字列に得点は入っていない（入っていても信じない）。返す数は全部ここで再生した値。

import type { GameSnapshot, RunStats, SimulationPort, Tier } from '../contracts/game';
import { HEAT_STATE_LIMITS } from '../game/constants';
import { createSimulation } from '../game/simulation';
import type { IndexedEvent } from '../replay/engine';
import { highlightsFromRun, type ReplayHighlight } from '../replay/highlights';
import { MAX_REPLAY_TICKS } from '../replay/limits';
import { createReplayRecord, type ReplayRecord } from '../replay/record';
import {
  decodePlay,
  encodePlay,
  SHARE_RULES_VERSION,
  type DecodeFailReason,
  type DecodePlayResult,
  type SharePlay,
} from './codec';

export type VerifyFailReason = DecodeFailReason | 'rulesMismatch' | 'tooLongToVerify';

export type VerifyOptions = Readonly<{
  /**
   * 再生してよい tick 数の上限（再生は tick 0 から始まるので、進めた tick 数と同じ）。
   * 上限まで進めても active のまま endTick に届かない場合、得点を確かめ切れないので
   * 'tooLongToVerify' で失敗にする。途中でゲームオーバーになる文字列はそこで止まるため、
   * endTick が上限を越えていても成功しうる。
   * 既定と最大はリプレイと同じ1時間。負の数は 0 と同じ（1 tick も進めない）。
   */
  maxTicks?: number;
}>;

export type VerifiedPlay = Readonly<{
  /** 再生し直した最後の得点 */
  score: number;
  bestTier: Tier;
  /** 実際に進めた tick 数。途中でゲームオーバーなら endTick より小さい */
  ticks: number;
  gameOver: boolean;
  /** 再生で数え直した戦績（射出数・合体数・超新星・最大連鎖）。文字列には無い、計算し直した値 */
  stats: RunStats;
  /** 再生で受理された射出の数。細工された入力は受理されず、ここが減る */
  inputsApplied: number;
  inputsTotal: number;
}>;

export type VerifyPlayResult =
  | { ok: true; play: SharePlay; result: VerifiedPlay }
  | { ok: false; reason: VerifyFailReason };


function toMaxTicks(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_REPLAY_TICKS, Math.max(0, Math.floor(value)))
    : MAX_REPLAY_TICKS;
}

/**
 * 文字列を読み、いまのルールで再生する。例外は投げない。
 * ルールの版が違う文字列は 'rulesMismatch' で弾く（別ルールで再生すると得点が合わないため）。
 * 途中でゲームオーバーになった場合はそこで止め、終わった時点の結果を返す。
 */
export function verifyPlay(text: string, options?: VerifyOptions): VerifyPlayResult {
  const run = recompute(text, options);
  if (!run.ok) return run;
  return { ok: true, play: run.play, result: run.result };
}

export function decodeReplayShare(
  text: string,
): DecodePlayResult | { ok: false; reason: 'rulesMismatch' } {
  const decoded = decodePlay(text);
  if (decoded.ok && decoded.play.rulesVersion !== SHARE_RULES_VERSION) {
    return { ok: false, reason: 'rulesMismatch' };
  }
  return decoded;
}

/** 端末保存の記録から、通常開始の現行ルールで再生できる入力だけを共有する。 */
export function encodeReplayShare(record: ReplayRecord): string {
  if (record.setup !== undefined || record.rulesVersion !== SHARE_RULES_VERSION) return '';
  return encodePlay(record);
}

export type ShareReplayResult =
  | { ok: true; record: ReplayRecord; final: GameSnapshot; highlights: readonly ReplayHighlight[] }
  | { ok: false; reason: VerifyFailReason | 'invalidRun' };

/** 受理されない入力や終点の不一致を弾き、受け手の物理計算から再生記録を作る。UIではWorkerで呼ぶ。 */
export function shareToReplay(text: string, options?: VerifyOptions): ShareReplayResult {
  const run = recompute(text, options, true);
  if (!run.ok) return run;
  if (run.result.inputsApplied !== run.play.inputs.length || run.result.ticks !== run.play.endTick) {
    return { ok: false, reason: 'invalidRun' };
  }
  return { ok: true, record: createReplayRecord(run.sim), final: run.sim.getSnapshot(), highlights: run.highlights };
}

function recompute(text: string, options?: VerifyOptions, collectHighlights = false):
  | { ok: true; play: SharePlay; result: VerifiedPlay; sim: SimulationPort; highlights: readonly ReplayHighlight[] }
  | { ok: false; reason: VerifyFailReason } {
  const decoded = decodeReplayShare(text);
  if (!decoded.ok) return decoded;
  const { play } = decoded;

  try {
    const maxTicks = toMaxTicks(options?.maxTicks);
    const sim = createSimulation(play.seed);
    let applied = 0;
    const initial = sim.getSnapshot();
    let snap = initial;
    const events: IndexedEvent[] = [];
    let critical = initial.heat >= HEAT_STATE_LIMITS[2] ? initial : null;
    const advance = (): void => {
      const surfaced = sim.stepFixed();
      snap = sim.getSnapshot();
      if (!collectHighlights) return;
      // 見どころに使う出来事だけ残し、長い共有記録でも着地などは蓄えない。
      for (const event of surfaced) {
        if (event.kind === 'merge' || event.kind === 'supernova' || event.kind === 'gameOver') {
          events.push({ at: snap.tick, event });
        }
      }
      if (!critical && snap.heat >= HEAT_STATE_LIMITS[2]) critical = snap;
    };
    // stepFixed は tick を 1 ずつ進めるので、ループは snap.tick === 目標 tick で必ず止まる
    const canStep = (): boolean => snap.phase === 'active' && snap.tick < maxTicks;
    for (const input of play.inputs) {
      while (snap.tick < input.tick && canStep()) {
        advance();
      }
      if (snap.tick !== input.tick || snap.phase !== 'active') {
        // まだ active なのに入力の tick へ届かない = 上限で止まった。
        // 作りかけの得点を正解として返せないので失敗にする。
        // ゲームが先に終わっていた場合は、残りの入力を捨てて終了時点の結果を返す。
        if (snap.phase === 'active') return { ok: false, reason: 'tooLongToVerify' };
        break;
      }
      const r = sim.submitLaunch(input);
      if (r.accepted) applied++;
      // 射出のあとも最新を取り直す。いまのルールでは射出は phase を変えないが、変わりうる将来に備える
      // （古い snap の 'active' を信じて進め続けると、終了済みの sim に stepFixed を呼ぶ無限ループになりうる）
      snap = sim.getSnapshot();
    }
    while (snap.tick < play.endTick && canStep()) {
      advance();
    }
    if (snap.tick < play.endTick && snap.phase === 'active') {
      return { ok: false, reason: 'tooLongToVerify' };
    }

    return {
      ok: true,
      play,
      sim,
      highlights: collectHighlights ? highlightsFromRun({ checkpoints: [initial], critical, events }) : [],
      result: {
        score: snap.score,
        bestTier: snap.bestTierThisRun,
        ticks: snap.tick,
        gameOver: snap.phase === 'over',
        stats: snap.stats,
        inputsApplied: applied,
        inputsTotal: play.inputs.length,
      },
    };
  } catch {
    // 文字列の読み取りは通ったが再生側で想定外が起きた場合も、外へ例外を出さず失敗として返す
    return { ok: false, reason: 'badData' };
  }
}
