// 共有文字列を受け取り、シミュレーションで最初から再生して結果を計算し直す。
// 文字列に得点は入っていない（入っていても信じない）。返す数は全部ここで再生した値。

import type { Tier } from '../contracts/game';
import { createSimulation } from '../game/simulation';
import {
  decodePlay,
  SHARE_RULES_VERSION,
  type DecodeFailReason,
  type SharePlay,
} from './codec';

export type VerifyFailReason = DecodeFailReason | 'rulesMismatch';

export type VerifiedPlay = Readonly<{
  /** 再生し直した最後の得点 */
  score: number;
  bestTier: Tier;
  /** 実際に進めた tick 数。途中でゲームオーバーなら endTick より小さい */
  ticks: number;
  gameOver: boolean;
  /** 再生で受理された射出の数。細工された入力は受理されず、ここが減る */
  inputsApplied: number;
  inputsTotal: number;
}>;

export type VerifyPlayResult =
  | { ok: true; play: SharePlay; result: VerifiedPlay }
  | { ok: false; reason: VerifyFailReason };

/**
 * 文字列を読み、いまのルールで再生する。例外は投げない。
 * ルールの版が違う文字列は 'rulesMismatch' で弾く（別ルールで再生すると得点が合わないため）。
 * 途中でゲームオーバーになった場合はそこで止め、終わった時点の結果を返す。
 */
export function verifyPlay(text: string): VerifyPlayResult {
  const decoded = decodePlay(text);
  if (!decoded.ok) return decoded;
  const { play } = decoded;
  if (play.rulesVersion !== SHARE_RULES_VERSION) return { ok: false, reason: 'rulesMismatch' };

  const sim = createSimulation(play.seed);
  let applied = 0;
  let snap = sim.getSnapshot();
  for (const input of play.inputs) {
    while (snap.tick < input.tick && snap.phase === 'active') {
      sim.stepFixed();
      snap = sim.getSnapshot();
    }
    // ゲームオーバー後の入力や、進み切れなかった入力は捨てる（入力の tick は endTick 以下に絞ってある）
    if (snap.tick !== input.tick || snap.phase !== 'active') break;
    const r = sim.submitLaunch({ originAngleRadians: input.originAngleRadians, vx: input.vx, vy: input.vy });
    if (r.accepted) applied++;
  }
  while (snap.tick < play.endTick && snap.phase === 'active') {
    sim.stepFixed();
    snap = sim.getSnapshot();
  }

  return {
    ok: true,
    play,
    result: {
      score: snap.score,
      bestTier: snap.bestTierThisRun,
      ticks: snap.tick,
      gameOver: snap.phase === 'over',
      inputsApplied: applied,
      inputsTotal: play.inputs.length,
    },
  };
}
