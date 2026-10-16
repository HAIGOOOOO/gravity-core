// 記録した入力ログ（LaunchInput の並び）から、同じプレイをもう一度まわす。
// seedTable で見つけた「異常に早く終わるシード」の再現や、最終盤面の検査に使う。
//
// 再現が成り立つ理由:
//   - シミュレーションは「同じシード・同じ setup・同じ射出」なら必ず同じ結果
//   - 弾かれた射出は盤面を一切変えない（submitLaunch が判定前に return する）ので、
//     ログに残っている受理分だけを同じ tick に撃てば、途中で弾かれていても同じになる
//
// 入力は tick の昇順を想定する（getInputLog() の並びをそのまま渡す）。
// 記録された tick より先に進んでしまった入力は、いまの tick で撃つ（ずれるので手で並べ替えたログ向け）。

import type { GameEvent, LaunchInput, SimulationPort, Tick } from '../contracts/game';
import { createSimulation, type SimulationSetup } from '../game/simulation';
import { DEFAULT_MAX_TICKS } from './batch';

export type ReplayOptions = Readonly<{
  /**
   * 入力を全部撃った後、この tick まで進めて止める。
   * 元のプレイの result.ticks を渡せば同じ終点で止まる。
   * 省略すると maxTicks（既定 10 分ぶん）か、終了するまで進む。
   * ※入力の tick までは必ず進むので、stopTick が最後の入力より前でも入力は全部撃つ。
   */
  stopTick?: number;
  /** stopTick 省略時の上限。既定は DEFAULT_MAX_TICKS */
  maxTicks?: number;
  /** 元のプレイと同じ setup を渡す。変えれば「同じ手順で条件だけ変えたら」も試せる */
  setup?: SimulationSetup;
}>;

export type ReplayOutcome = Readonly<{
  sim: SimulationPort;
  /** 実際に受理された射出数。途中で終わると残りは弾かれるので、ログの長さより少なくなることがある */
  submitted: number;
}>;

/** phase が 'active' の間、指定の tick まで進める。すでに過ぎていたり終了していたら何もしない。 */
export function stepUntil(sim: SimulationPort, tick: number, onEvent?: (event: GameEvent) => void): void {
  for (;;) {
    const s = sim.getSnapshot();
    if (s.phase !== 'active' || s.tick >= tick) return;
    for (const e of sim.stepFixed()) onEvent?.(e);
  }
}

/**
 * 入力ログを同じ tick に撃ち直してプレイを再現する。
 * 途中で終了した場合、残りの入力は全部弾かれてそのまま止まる。
 */
export function replayLaunches(seed: number, inputs: readonly LaunchInput[], options: ReplayOptions = {}): ReplayOutcome {
  const sim = createSimulation(seed, options.setup);
  const until = options.stopTick ?? options.maxTicks ?? DEFAULT_MAX_TICKS;

  let submitted = 0;
  for (const input of inputs) {
    stepUntil(sim, input.tick);
    const res = sim.submitLaunch({
      originAngleRadians: input.originAngleRadians,
      vx: input.vx,
      vy: input.vy,
    });
    if (res.accepted) submitted++;
  }
  stepUntil(sim, until);
  return { sim, submitted };
}

/**
 * 途中まで再現した sim に、残りの入力を記録の tick で撃ち込みながら until まで進める。
 * boardBeforeShot で戻した盤面に射出を撃ち直したあと、そのままプレイの続きを再現する用。
 *
 * 記録された結末（着地・合体の tick）は「あとの射出も含むプレイ」の結果なので、
 * 撃ち直した 1 射だけで進めても一致しないことがある。残りの入力も撃ち直せば元の
 * プレイと同じ入力列になるので、あとの射出が起こした合体も同じ tick で起きる。
 * onEvent は stepFixed が返した各イベントを受け取る観察口。返り値は受理された射出数。
 */
export function continueReplay(
  sim: SimulationPort,
  inputs: readonly LaunchInput[],
  until: Tick,
  onEvent?: (event: GameEvent) => void,
): number {
  let submitted = 0;
  for (const input of inputs) {
    stepUntil(sim, input.tick, onEvent);
    const res = sim.submitLaunch({
      originAngleRadians: input.originAngleRadians,
      vx: input.vx,
      vy: input.vy,
    });
    if (res.accepted) submitted++;
  }
  stepUntil(sim, until, onEvent);
  return submitted;
}

/**
 * 記録した射出の「撃つ直前」の盤面を再現する。
 * 的中率の記録（missTable で拾った外れなど）について、ボットが実際に見ていた盤面と予測をもう一度見る用。
 *
 * shotTick より前の入力だけを撃ち直して、その tick で止める。
 * 受理された射出は必ず別々の tick にあるので、この絞り方ではずれない。
 * 戻った sim に対して:
 *   - predict(shot.command)      → 記録と同じ予測が取れる（予測は盤面だけで決まる）
 *   - submitLaunch(shot.command) → continueReplay で残りの入力も撃ち直せば、記録の結末を追い直せる
 */
export function boardBeforeShot(
  seed: number,
  inputs: readonly LaunchInput[],
  shotTick: Tick,
  options: { setup?: SimulationSetup } = {},
): SimulationPort {
  const before = inputs.filter((i) => i.tick < shotTick);
  return replayLaunches(seed, before, { stopTick: shotTick, setup: options.setup }).sim;
}
