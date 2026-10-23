// 共有文字列を受け取り、シミュレーションで最初から再生して結果を計算し直す。
// 文字列に得点は入っていない（入っていても信じない）。返す数は全部ここで再生した値。
//
// 再生の計算量はプレイの長さ（endTick）に比例し、正当な文字列でも最大 4 時間ぶんある。
// 入力なし・endTick 最大に細工された文字列をそのまま再生すると長時間かかるので、
// 止まってはいけない所（UI など）から呼ぶときは options.maxTicks で打ち切る。

import type { RunStats, Tier } from '../contracts/game';
import { createSimulation } from '../game/simulation';
import { expandLaunchInputs } from '../shared/input-timeline';
import {
  decodePlay,
  SHARE_RULES_VERSION,
  type DecodeFailReason,
  type SharePlay,
} from './codec';

export type VerifyFailReason = DecodeFailReason | 'rulesMismatch' | 'tooLongToVerify';

export type VerifyOptions = Readonly<{
  /**
   * 再生してよい tick 数の上限（再生は tick 0 から始まるので、進めた tick 数と同じ）。
   * 上限まで進めても active のまま endTick に届かない場合、得点を確かめ切れないので
   * 'tooLongToVerify' で失敗にする。途中でゲームオーバーになる文字列はそこで止まるため、
   * endTick が上限を越えていても成功しうる。
   * 省略・有限でない数・数以外の値は「上限なし」。負の数は 0 と同じ（1 tick も進めない）。
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

/** maxTicks の引数を整える。有限の数だけ受け、それ以外（省略・NaN・文字列など）は上限なしにする。 */
function toMaxTicks(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : Infinity;
}

/**
 * 文字列を読み、いまのルールで再生する。例外は投げない。
 * ルールの版が違う文字列は 'rulesMismatch' で弾く（別ルールで再生すると得点が合わないため）。
 * 途中でゲームオーバーになった場合はそこで止め、終わった時点の結果を返す。
 */
export function verifyPlay(text: string, options?: VerifyOptions): VerifyPlayResult {
  const decoded = decodePlay(text);
  if (!decoded.ok) return decoded;
  const { play } = decoded;
  if (play.rulesVersion !== SHARE_RULES_VERSION) return { ok: false, reason: 'rulesMismatch' };

  try {
    const maxTicks = toMaxTicks(options?.maxTicks);
    const sim = createSimulation(play.seed);
    let applied = 0;
    let snap = sim.getSnapshot();
    // stepFixed は tick を 1 ずつ進めるので、ループは snap.tick === 目標 tick で必ず止まる
    const canStep = (): boolean => snap.phase === 'active' && snap.tick < maxTicks;
    const actions = expandLaunchInputs(play.inputs, play.endTick);
    if (!actions) return { ok: false, reason: 'badData' };
    for (const input of actions) {
      while (snap.tick < input.tick && canStep()) {
        sim.stepFixed();
        snap = sim.getSnapshot();
      }
      if (snap.tick !== input.tick || snap.phase !== 'active') {
        // まだ active なのに入力の tick へ届かない = 上限で止まった。
        // 作りかけの得点を正解として返せないので失敗にする。
        // ゲームが先に終わっていた場合は、残りの入力を捨てて終了時点の結果を返す。
        if (snap.phase === 'active') return { ok: false, reason: 'tooLongToVerify' };
        break;
      }
      if (input.kind === 'launch') {
        const r = sim.submitLaunch(input.input);
        if (r.accepted) applied++;
      } else if (!sim.submitGravity({ kind: 'collapse' }).accepted) return { ok: false, reason: 'badData' };
      // 射出のあとも最新を取り直す。いまのルールでは射出は phase を変えないが、変わりうる将来に備える
      // （古い snap の 'active' を信じて進め続けると、終了済みの sim に stepFixed を呼ぶ無限ループになりうる）
      snap = sim.getSnapshot();
    }
    while (snap.tick < play.endTick && canStep()) {
      sim.stepFixed();
      snap = sim.getSnapshot();
    }
    if (snap.tick < play.endTick && snap.phase === 'active') {
      return { ok: false, reason: 'tooLongToVerify' };
    }

    return {
      ok: true,
      play,
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
