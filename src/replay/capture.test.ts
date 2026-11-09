import { describe, expect, it } from 'vitest';
import { HEAT_STATE_LIMITS } from '../game/constants';
import { createSimulation } from '../game/simulation';
import { at, dropAt } from '../fixtures';
import { createReplayCapture } from './capture';
import { runReplay } from './engine';
import { createReplayRecord, parseReplay, serializeReplay, snapshotHash } from './record';
import { highlightsFromRun } from './highlights';
import { causeFromRun } from './cause';

describe('プレイ中に準備する再生', () => {
  it('入力の受付・盤面・出来事は本物の計算と一致し、結果も独立した再検証と一致する', () => {
    const capture = createReplayCapture(7);
    const actual = createSimulation(7);
    for (let tick = 0; tick < 1800; tick++) {
      if (tick % 110 === 0) {
        const input = dropAt(tick / 110);
        expect(capture.simulation.submitLaunch(input)).toEqual(actual.submitLaunch(input));
      }
      expect(capture.simulation.stepFixed()).toEqual(actual.stepFixed());
      expect(capture.simulation.getSnapshot()).toEqual(actual.getSnapshot());
    }
    const result = capture.finish();
    expect(result.record.finalHash).toBe(snapshotHash(actual.getSnapshot()));
    const checked = runReplay(parseReplay(serializeReplay(result.record))!, { checkpointEvery: 0 });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(result.highlights).toEqual(highlightsFromRun(checked));
    expect(result.cause).toEqual(causeFromRun(checked));
    const start = result.createPlayer();
    expect(start.ok).toBe(true);
    if (start.ok) expect(start.player.seek(result.record.endTick)).toEqual(actual.getSnapshot());
  });

  it('途中で保存した結果は、その後のプレイから切り離される', () => {
    const capture = createReplayCapture(3);
    const old = capture.finish();
    expect(capture.finish()).toBe(old);
    capture.simulation.submitLaunch(dropAt(-Math.PI / 2));
    const launched = capture.finish();
    expect(launched).not.toBe(old);
    expect(launched.record.endTick).toBe(0);
    for (let tick = 0; tick < 400; tick++) capture.simulation.stepFixed();
    const later = capture.finish();
    expect(later.record.finalScore).toBeGreaterThan(old.record.finalScore);
    for (const saved of [old, launched, later]) {
      const checked = runReplay(saved.record);
      expect(checked.ok).toBe(true);
      const player = saved.createPlayer();
      expect(player.ok).toBe(true);
      if (player.ok) expect(snapshotHash(player.player.seek(saved.record.endTick))).toBe(saved.record.finalHash);
    }
    expect(old.highlights).toHaveLength(0);
    expect(old.record.inputs).toHaveLength(0);
  });

  it('臨界ちょうど・負けた原因・終了後に呼び続ける場合も再検証と一致する', () => {
    const setup = { heat: HEAT_STATE_LIMITS[2], bodies: [at(7, 130, 0), at(6, 280, 0), at(5, 400, 0)] };
    const capture = createReplayCapture(1, setup);
    while (capture.simulation.getSnapshot().phase === 'active') capture.simulation.stepFixed();
    const result = capture.finish();
    for (let tick = 0; tick < 20; tick++) capture.simulation.stepFixed();
    expect(capture.finish()).toBe(result);
    const checked = runReplay(createReplayRecord(capture.simulation, { setup }));
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(result.cause).toEqual(causeFromRun(checked));
    expect(result.highlights).toEqual(highlightsFromRun(checked));
  });
});
