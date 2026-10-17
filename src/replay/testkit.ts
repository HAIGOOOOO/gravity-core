// テスト共用の小さな道具。*.test.ts からだけ import する（本番コードは使わない）。
// 記録の作り方を 1 箇所に集めて、テストごとの作り方の違いで結果がぶれないようにする。

import type { GameSnapshot, SimulationPort } from '../contracts/game';
import { createAutoPlay, dropAt } from '../fixtures/index';
import { createSimulation, type SimulationSetup } from '../game/simulation';
import { createReplayRecord, type ReplayRecord } from './record';

/** 真上（天体を核へまっすぐ落とす向き）。 */
export const UP = -Math.PI / 2;

/** 自動プレイを maxTicks まで（終了ならそこまで）進め、記録と最後の盤面を返す。 */
export function recordAutoPlay(seed: number, maxTicks: number): { record: ReplayRecord; final: GameSnapshot } {
  const auto = createAutoPlay(seed);
  let snap = auto.sim.getSnapshot();
  for (let i = 0; i < maxTicks && snap.phase === 'active'; i++) {
    auto.step();
    snap = auto.sim.getSnapshot();
  }
  return { record: createReplayRecord(auto.sim), final: snap };
}

/** 特別な開始状態から決まった tick ぶん進めて記録を作る。 */
export function recordSetup(seed: number, setup: SimulationSetup, maxTicks: number): ReplayRecord {
  const sim = createSimulation(seed, setup);
  let snap = sim.getSnapshot();
  for (let i = 0; i < maxTicks && snap.phase === 'active'; i++) {
    sim.stepFixed();
    snap = sim.getSnapshot();
  }
  return createReplayRecord(sim, { setup });
}

/** 同じシードの自動プレイをもう一度回して、ある tick の盤面（JSON）を取る。無ければ undefined。 */
export function snapshotJsonAt(seed: number, tick: number): string | undefined {
  const auto = createAutoPlay(seed);
  // tick までに丁度届く。先に終わった・到達しない時は undefined（無限ループしないよう回数で止める）
  for (let i = 0; i <= tick; i++) {
    const snap = auto.sim.getSnapshot();
    if (snap.tick === tick) return JSON.stringify(snap);
    if (snap.tick > tick || snap.phase === 'over') return undefined;
    auto.step();
  }
  return undefined;
}

/**
 * 角度を少しずつ変えながら、受理されるまで射出を試す。
 * 盤面の状態（冷却・射出点の混み具合）で拒否される事があるため、1 角度だけに頼らない。
 */
export function launchAnyhow(sim: SimulationPort, angle: number): boolean {
  for (const da of [0, 0.5, -0.5, 1.0, -1.0, 1.6]) {
    if (sim.submitLaunch(dropAt(angle + da)).accepted) return true;
  }
  return false;
}
