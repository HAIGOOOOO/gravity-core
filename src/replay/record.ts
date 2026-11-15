// 1 回のプレイをそっくり再生するための記録。
// 同じシードと同じ入力なら src/game/ の計算は必ず同じ結果になるので、
// 記録には盤面ではなく「シードと入力ログ」を持つ。
// ルール（constants.ts の数値）が変わると同じ手順でも結果が変わるため、
// ルールの版の指紋を一緒に保存し、合わない記録は再生しない。

import type { GameSnapshot, LaunchInput, RunStats, SimulationPort, Tick } from '../contracts/game';
import { createSimulation, type SimulationSetup } from '../game/simulation';

import { hashText, REPLAY_FORMAT, rulesVersion } from './rules';
export { REPLAY_FORMAT, rulesVersion } from './rules';

export type ReplayRecord = Readonly<{
  format: typeof REPLAY_FORMAT;
  /** rulesVersion() が作る指紋。今のルールと違う記録は「合わない」結果を返す */
  rulesVersion: string;
  seed: number;
  /** 受理された射出の時系列ログ（SimulationPort.getInputLog()）。拒否された射出は含まれない */
  inputs: readonly LaunchInput[];
  /** 記録した時点の tick */
  endTick: Tick;
  finalScore: number;
  finalBodyCount: number;
  /**
   * 開始時（tick 0・入力を反映する前）の盤面の指紋。
   * finalHash だけでは、終わる頃に同じ状態へ収束する細工を見逃す
   * （例: 開始時の熱量を足しても、その後の冷却で最終盤面が同じになる）。
   * 開始の指紋も持つことで、seed・setup・初期キューの書き換えが全部「合わない」と分かる。
   */
  initialHash: string;
  /**
   * 記録した時点の盤面の指紋（snapshotHash）。
   * 得点・tick・天体・熱量・キュー全部を畳んだ物なので、入力を抜く・得点を盛る・
   * endTick を延ばす等の書き換えは全部ここで「合わない」と分かる。
   */
  finalHash: string;
  phase: 'active' | 'over';
  stats: RunStats;
  /**
   * 特別な開始状態から始めたプレイだけ持つ（通常のプレイでは無い）。
   * 開始時の盤面・熱量・キュー・到達 Tier を変えたシミュレーションは、
   * これが無いとシードと入力だけでは再現できない。
   */
  setup?: SimulationSetup;
  /** ISO 8601 */
  createdAt: string;
}>;

/**
 * 盤面の指紋。GameSnapshot をそのまま JSON 化して畳む。
 * tick・天体・得点・熱量・キューのどれか 1 つでも違えば変わる。
 * 計算し直した盤面と記録の照合に使う（src/game/ は決定的なので同じ盤面は同じ文字列）。
 */
export function snapshotHash(snap: GameSnapshot): string {
  return hashText(JSON.stringify(snap));
}

// ───────── 記録を作る ─────────

// 呼び出し側があとで setup を書き換えても記録が腐らないよう、中身を複製する。
// （inputs と stats は最初から複製している。ここだけ参照のままだった）
// player も、カーソルがあとから読む setup の複製にこれを使う。
export function copySetup(setup: SimulationSetup): SimulationSetup {
  const copy: SimulationSetup = { ...setup };
  if (setup.bodies) copy.bodies = setup.bodies.map((b) => ({ ...b }));
  if (setup.queue) copy.queue = [...setup.queue];
  return copy;
}

/**
 * プレイ中（あるいは終了後）のシミュレーションから記録を作る。
 * 盤面は持たず、シードと受理済みの入力ログを写す。
 *
 * createSimulation に setup を渡して始めたプレイでは、同じ物を options.setup に
 * 渡すこと。SimulationPort は開始状態を外に出さないので、渡さないと
 * 「通常開始の記録」として保存され、再生時に開始の盤面が合わず
 * 必ず diverged になる（黙って再現できない記録を作るより、分かる方が安全）。
 */
export function createReplayRecord(
  sim: SimulationPort,
  options: { now?: Date; setup?: SimulationSetup } = {},
): ReplayRecord {
  const snap = sim.getSnapshot();
  const record: ReplayRecord = {
    format: REPLAY_FORMAT,
    rulesVersion: rulesVersion(),
    seed: snap.seed,
    inputs: sim.getInputLog().map((i) => ({ ...i })),
    endTick: snap.tick,
    finalScore: snap.score,
    finalBodyCount: snap.bodies.length,
    // 開始の盤面はシードと setup だけで決まるので、同じ組み立てで作り直して指紋を取る
    initialHash: snapshotHash(createSimulation(snap.seed, options.setup).getSnapshot()),
    finalHash: snapshotHash(snap),
    phase: snap.phase,
    stats: { ...snap.stats },
    createdAt: (options.now ?? new Date()).toISOString(),
  };
  // 通常の開始（既定の 1 体だけの盤面）では setup は付けない
  return options.setup === undefined ? record : { ...record, setup: copySetup(options.setup) };
}

export { serializeReplay, parseReplay } from './serialization';
