// 「なぜ負けたか」を、記録をもう一度流して確かめる。
// 熱量は「限界リングを越えた天体がある間だけ」上がるので、
// ゲームオーバー直前の最後の overLimitStart が、致命的な上昇の始まり。
// その時点で越えていた天体（BodyView.overLimit）を、原因として返す。

import type { BodyView, GameSnapshot, Tick } from '../contracts/game';
import { runReplay, type ReplayFailure, type ReplayRun } from './engine';
import type { ReplayRecord } from './record';

export type DefeatCause = Readonly<{
  /** gameOver が起きた tick */
  gameOverTick: Tick;
  /** 最後に熱量が上がり始めた tick（最後の overLimitStart） */
  heatRiseTick: Tick;
  /** その時点で限界リングを越えていた天体 */
  culprits: readonly BodyView[];
  /** 熱量が上がり始めた時点の盤面全体（巻き戻し表示に使う） */
  snapshot: GameSnapshot;
}>;

export type CauseResult = Readonly<{ ok: true; cause: DefeatCause | null }> | ReplayFailure;

/**
 * 負けた理由を返す。ゲームオーバーしていない記録なら cause は null。
 * 版が違う・記録と合わない時は ReplayFailure。
 */
export function analyzeCause(record: ReplayRecord): CauseResult {
  const run = runReplay(record, { checkpointEvery: 0 });
  if (!run.ok) return run;
  return { ok: true, cause: causeFromRun(run) };
}

/** プレイヤー・見どころと同じ検証結果から負けた原因を取る。 */
export function causeFromRun(run: ReplayRun): DefeatCause | null {
  if (run.final.phase !== 'over') return null;
  // 開始時点から越え続けていた等で overLimitStart が無い異例の記録向け。
  // その場合は終了時点の盤面を「上がり始め」とみなす。
  const atRise = run.lastHeatRise ?? run.final;
  return {
      gameOverTick: run.final.tick,
      heatRiseTick: atRise.tick,
      culprits: atRise.bodies.filter((b) => b.overLimit),
      snapshot: atRise,
  };
}
