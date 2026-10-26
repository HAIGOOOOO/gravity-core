import { describe, expect, it } from 'vitest';
import { copyLoss, lossFromOverflow } from './loss';
import { createSimulation, restoreSimulation } from './simulation';
import { createReplayRecord } from '../replay/record';
import { runReplay } from '../replay/engine';
import { analyzeCause } from '../replay/cause';
import { dropAt } from '../fixtures';
import { TICK_HZ } from './constants';

const body = (id: number, x: number) => ({ id, tier: 4 as const, x, y: 0, vx: 0, vy: 0, radius: 41,
  bornTick: 0, chain: 0, chainUntilTick: 0, overLimit: x > 300, landed: true, growLeft: 0 });

describe('終了した瞬間の敗因', () => {
  it('実際に熱を上げていた中から最外縁の1体を選び、同距離は小さいIDにする', () => {
    const loss = lossFromOverflow([body(3, 330), body(2, 360), body(1, 360)], 200)!;
    expect(loss.culprit.id).toBe(1); expect(loss.overflowPx).toBe(81);
    expect(lossFromOverflow([{ ...body(1, 360), overLimit: false }], 200)).toBeNull();
  });
  it('代表天体のすぐ隣で、成熟した同階級の連鎖相手だけを惜しさとして渡す', () => {
    const culprit = body(1, 330), partner = { ...body(2, 246), chain: 2, chainUntilTick: 260 };
    const loss = lossFromOverflow([culprit, partner], 200)!;
    expect(loss.nearFusion).toEqual({ bodyIds: [1, 2], tier: 4, gapPx: 2, chain: 3 });
    for (const other of [{ ...partner, chainUntilTick: 10 }, { ...partner, growLeft: .1 }, { ...partner, x: 230 }, { ...partner, bornTick: 199 }]) {
      expect(lossFromOverflow([culprit, other], 200)!.nearFusion).toBeUndefined();
    }
    const copied = copyLoss(loss);
    if (copied.kind === 'overLimit') {
      Object.assign(copied.culprit, { x: 999 }); Object.assign(copied.nearFusion!.bodyIds, { 0: 999 });
    }
    expect(loss.culprit.x).toBe(330); expect(loss.nearFusion!.bodyIds[0]).toBe(1);
  });
  it('限界外の山による終了を出来事・盤面・途中復元・再生で保持する', () => {
    const setup = { heat: 95, bodies: [{ tier: 7 as const, x: 130, y: 0 }, { tier: 6 as const, x: 280, y: 0 }, { tier: 5 as const, x: 400, y: 0 }] };
    const sim = createSimulation(5, setup); let eventLoss;
    for (let n = 0; n < 5 * TICK_HZ && sim.getSnapshot().phase === 'active'; n++) {
      const event = sim.stepFixed().find(e => e.kind === 'gameOver'); if (event) eventLoss = event.loss;
    }
    expect(sim.getSnapshot().loss?.kind).toBe('overLimit'); expect(eventLoss).toEqual(sim.getSnapshot().loss);
    const state = sim.exportState(), restored = restoreSimulation(state);
    expect(restored.getSnapshot()).toEqual(sim.getSnapshot());
    if (state.loss?.kind === 'overLimit') Object.assign(state.loss.culprit, { x: 999 });
    expect(restored.getSnapshot().loss).toEqual(sim.getSnapshot().loss);
    const run = runReplay(createReplayRecord(sim, { setup })); expect(run.ok).toBe(true);
    if (run.ok) expect(run.final.loss).toEqual(sim.getSnapshot().loss);
  });
  it('射出の加熱で終わった場合も、過去の限界越えと混同せず終端イベントを残す', () => {
    const sim = createSimulation(31);
    for (let n = 0; n < 3 * 60 * TICK_HZ && sim.getSnapshot().phase === 'active'; n++) {
      if (sim.getSnapshot().launchCooldownLeftSeconds <= 0) sim.submitLaunch(dropAt(0));
      sim.stepFixed();
    }
    expect(sim.getSnapshot().loss?.kind).toBe('repeatLaunch');
    const record = createReplayRecord(sim), run = runReplay(record); expect(run.ok).toBe(true);
    if (run.ok) expect(run.events.filter(e => e.event.kind === 'gameOver')).toHaveLength(1);
    const cause = analyzeCause(record); expect(cause.ok).toBe(true);
    if (cause.ok) expect(cause.cause?.loss).toEqual(sim.getSnapshot().loss);
  });
});
