import { describe, expect, it } from 'vitest';
import { dropAt } from '../fixtures';
import { setupInterventionPractice } from '../fixtures/intervention';
import { createReplayRecord, parseReplay, serializeReplay } from '../replay/record';
import { runReplay } from '../replay/engine';
import { createReplayPlayer } from '../replay/player';
import { decodePlay, encodePlay, encodeSimulation, SHARE_RULES_VERSION } from '../share/codec';
import { verifyPlay } from '../share/verify';
import { expandLaunchInputs } from '../shared/input-timeline';
import { BURST_MAX, INTERVENTION_WINDOW_SECONDS, TICK_HZ } from './constants';
import { createRng } from './rng';
import { createSimulation, restoreSimulation } from './simulation';

function ready() {
  const setup = setupInterventionPractice(), sim = createSimulation(31, setup);
  expect(sim.stepFixed().filter((e) => e.kind === 'merge')).toHaveLength(12);
  expect(sim.getSnapshot().intervention?.charge).toBe(BURST_MAX);
  const shot = sim.submitLaunch(dropAt(0));
  expect(shot.accepted).toBe(true);
  return { sim, setup, shotId: shot.accepted ? shot.bodyId : -1 };
}

describe('射出後の一手', () => {
  it('最初は未解放で、解放後も射出とゲージが必要。他の試作操作は本番に出さない', () => {
    const sim = createSimulation(1);
    expect(sim.submitGravity({ kind: 'collapse' })).toEqual({ accepted: false, reason: 'locked' });
    expect(sim.submitGravity({ kind: 'grip', on: true })).toEqual({ accepted: false, reason: 'disabled' });
    const later = createSimulation(1, { bestTier: 3, bodies: [] });
    expect(later.submitGravity({ kind: 'collapse' })).toEqual({ accepted: false, reason: 'noShot' });
    later.submitLaunch(dropAt(0));
    expect(later.submitGravity({ kind: 'collapse' })).toEqual({ accepted: false, reason: 'noCharge' });
  });
  it('一度だけ使い、実際に山を締めて熱を下げ、入力と出来事を残す', () => {
    const { sim, shotId } = ready(), plain = restoreSimulation(sim.exportState());
    expect(sim.getSnapshot().intervention?.ready).toBe(true);
    expect(sim.submitGravity({ kind: 'collapse' }).accepted).toBe(true);
    expect(sim.submitGravity({ kind: 'collapse' })).toEqual({ accepted: false, reason: 'alreadyUsed' });
    expect(sim.getInputLog().at(-1)?.collapseTick).toBe(1);
    const events = sim.stepFixed(); plain.stepFixed();
    expect(events.filter((e) => e.kind === 'collapse')).toHaveLength(1);
    for (let i = 0; i < 20; i++) {
      sim.stepFixed(); plain.stepFixed();
      expect(sim.getSnapshot().intervention?.coolingThisTick).toBeGreaterThan(0);
    }
    expect(sim.getSnapshot().heat).toBeLessThan(plain.getSnapshot().heat - 3);
    const edge = (s: typeof sim) => Math.max(...s.getSnapshot().bodies.filter((b) => b.id !== shotId).map((b) => Math.hypot(b.x, b.y)));
    expect(edge(sim)).toBeLessThan(edge(plain));
  });
  it('窓の終端では断り、拒否された射出で窓を延ばさず、次の成功した射出で開き直す', () => {
    const { sim } = ready();
    for (let i = 0; i < Math.round(INTERVENTION_WINDOW_SECONDS * TICK_HZ); i++) sim.stepFixed();
    expect(sim.submitLaunch({ originAngleRadians: 0, vx: 0, vy: 0 }).accepted).toBe(false);
    expect(sim.submitGravity({ kind: 'collapse' })).toEqual({ accepted: false, reason: 'expired' });
    expect(sim.submitLaunch(dropAt(1)).accepted).toBe(true);
    expect(sim.submitGravity({ kind: 'collapse' }).accepted).toBe(true);
  });
  it('途中復元は窓・使用済み・進行中の崩壊も同じ続きになる', () => {
    const { sim } = ready(), restored = restoreSimulation(sim.exportState());
    expect(restored.submitGravity({ kind: 'collapse' })).toEqual(sim.submitGravity({ kind: 'collapse' }));
    for (let i = 0; i < 80; i++) expect(restored.stepFixed()).toEqual(sim.stepFixed());
    expect(restored.getSnapshot()).toEqual(sim.getSnapshot());
    const again = restoreSimulation(sim.exportState());
    expect(again.submitGravity({ kind: 'collapse' })).toEqual({ accepted: false, reason: 'alreadyUsed' });
    for (let i = 0; i < 100; i++) expect(again.stepFixed()).toEqual(sim.stepFixed());
  });
  it('同tickの崩壊→次の射出を、保存・検証・逆方向へのシークでも保持する', () => {
    const { sim, setup } = ready();
    for (let i = 0; i < 61; i++) sim.stepFixed();
    expect(sim.submitGravity({ kind: 'collapse' }).accepted).toBe(true);
    expect(sim.submitLaunch(dropAt(1)).accepted).toBe(true);
    const record = createReplayRecord(sim, { setup });
    const parsed = parseReplay(serializeReplay(record))!;
    const run = runReplay(parsed); expect(run.ok).toBe(true);
    if (run.ok) expect(run.final).toEqual(sim.getSnapshot());
    const player = createReplayPlayer(parsed); expect(player.ok).toBe(true);
    if (player.ok) { player.player.seek(20); expect(player.player.seek(62)).toEqual(sim.getSnapshot()); }
    const text = encodePlay({ rulesVersion: SHARE_RULES_VERSION, seed: 31, inputs: record.inputs, endTick: record.endTick });
    const decoded = decodePlay(text); expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.play.inputs).toEqual(record.inputs);
  });
  it('範囲外・次の射出をまたぐ介入を保存しない', () => {
    const first = { ...dropAt(0), tick: 10, collapseTick: 71 }, second = { ...dropAt(1), tick: 70 };
    expect(expandLaunchInputs([first, second], 100)).toBeNull();
    for (const collapseTick of [9, 154, 10.5, Infinity]) {
      expect(encodePlay({ rulesVersion: SHARE_RULES_VERSION, seed: 1, endTick: 200, inputs: [{ ...first, collapseTick }] })).toBe('');
    }
  });
  it('通常開始でゲージをためた実プレイの崩壊も、共有から同じ得点と戦績になる', () => {
    const sim = createSimulation(11), rng = createRng(12);
    for (let i = 0; i < 60 * TICK_HZ && !sim.getSnapshot().intervention?.ready; i++) {
      if (i % 70 === 0) sim.submitLaunch(dropAt(rng() * Math.PI * 2));
      sim.stepFixed();
    }
    expect(sim.getSnapshot().intervention?.ready).toBe(true);
    expect(sim.submitGravity({ kind: 'collapse' }).accepted).toBe(true);
    for (let i = 0; i < 2 * TICK_HZ; i++) sim.stepFixed();
    const result = verifyPlay(encodeSimulation(sim)); expect(result.ok).toBe(true);
    if (result.ok) { expect(result.result.score).toBe(sim.getSnapshot().score); expect(result.result.stats).toEqual(sim.getSnapshot().stats); }
    const replay = runReplay(createReplayRecord(sim)); expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.final).toEqual(sim.getSnapshot());
  });
});
