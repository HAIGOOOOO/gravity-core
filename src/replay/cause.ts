// 「なぜ負けたか」を、記録をもう一度流して確かめる。
// 熱量は「限界リングを越えた天体がある間だけ」上がるので、
// ゲームオーバー直前の最後の overLimitStart が、致命的な上昇の始まり。
// その時点で越えていた天体（BodyView.overLimit）を、原因として返す。

import type { BodyView, GameSnapshot, Tick } from '../contracts/game';
import { runReplay, type ReplayFailure } from './engine';
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
  let riseTick: Tick | null = null;
  let riseSnap: GameSnapshot | null = null;
  let overTick: Tick | null = null;

  const run = runReplay(record, {
    visit: (snap, surfaced) => {
      for (const e of surfaced) {
        if (e.kind === 'overLimitStart') {
          riseTick = snap.tick;
          riseSnap = snap;
        } else if (e.kind === 'gameOver') {
          overTick = snap.tick;
        }
      }
    },
  });
  if (!run.ok) return run;
  if (overTick === null) return { ok: true, cause: null };

  // 開始時点から越え続けていた等で overLimitStart が無い異例の記録向け。
  // その場合は終了時点の盤面を「上がり始め」とみなす。
  const atRise: GameSnapshot = riseSnap ?? run.final;
  return {
    ok: true,
    cause: {
      gameOverTick: overTick,
      heatRiseTick: riseTick ?? overTick,
      culprits: atRise.bodies.filter((b) => b.overLimit),
      snapshot: atRise,
    },
  };
}
