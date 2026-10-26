import { describe, expect, it } from 'vitest';
import { dropAt } from '../fixtures';
import { launchHeating } from './launch-heat';
import { BOARD_ROTATION_RADIANS_PER_SECOND, REPEAT_LAUNCH_MEMORY, TICK_HZ } from './constants';
import { createSimulation, restoreSimulation } from './simulation';
import { createReplayRecord, parseReplay, serializeReplay } from '../replay/record';
import { createReplayPlayer } from '../replay/player';
import { encodeSimulation, decodePlay } from '../share/codec';
import { verifyPlay } from '../share/verify';

describe('同じ方角への連投の熱', () => {
  const history = Array.from({ length: REPEAT_LAUNCH_MEMORY }, (_, n) => ({ tick: n * 60, originAngleRadians: 0 }));
  it('序盤と最初の2投は加熱せず、角度の折返しと直近8投だけを数える', () => {
    expect(launchHeating(480, 2, history, 0)).toBe(0);
    expect(launchHeating(480, 3, history.slice(0, 1), 0)).toBe(0);
    expect(launchHeating(480, 3, history.slice(0, 2), Math.PI * 2)).toBe(2);
    expect(launchHeating(480, 3, history, 0)).toBe(14);
    const other = history.map(i => ({ ...i, originAngleRadians: Math.PI }));
    expect(launchHeating(480, 3, [...history, ...other], 0)).toBe(0);
  });
  it('山の流れを追いかける連投も数え、同じ入力を二重に加熱しない', () => {
    const tick = 480;
    const carried = history.map(i => ({ ...i, originAngleRadians: -BOARD_ROTATION_RADIANS_PER_SECOND * (tick - i.tick) / TICK_HZ }));
    expect(launchHeating(tick, 3, carried, 0)).toBe(14);
  });
  it('予測の加熱は副作用を持たず、拒否した投げは加熱せず、上限で終わっても出来事を一度届ける', () => {
    const sim = createSimulation(31, { bodies: [], bestTier: 3 });
    for (let shot = 0; shot < 4; shot++) {
      expect(sim.submitLaunch(dropAt(0)).accepted).toBe(true);
      for (let n = 0; n < 61; n++) sim.stepFixed();
    }
    const ready = restoreSimulation({ ...sim.exportState(), heat: 99, cooldown: 0 });
    const before = ready.getSnapshot(), log = ready.getInputLog();
    expect(ready.predict(dropAt(0)).launchHeat).toBe(1);
    expect(ready.predict(dropAt(0)).launchHeat).toBe(1);
    expect(ready.submitLaunch({ originAngleRadians: 0, vx: 0, vy: 0 }).accepted).toBe(false);
    expect(ready.getSnapshot()).toEqual(before); expect(ready.getInputLog()).toEqual(log);
    expect(ready.submitLaunch(dropAt(0))).toMatchObject({ accepted: true, heatDelta: 1 });
    expect(ready.getSnapshot()).toMatchObject({ phase: 'over', heat: 100, tick: before.tick });
    const events = ready.stepFixed();
    expect(events.filter(e => e.kind === 'launch' && e.heatDelta === 1)).toHaveLength(1);
    expect(events.filter(e => e.kind === 'gameOver')).toHaveLength(1);
    expect(ready.stepFixed()).toEqual([]);
  });
  it('実プレイの加熱による終了を、圧縮保存・巻戻し・共有でも同じ結果へ戻す', () => {
    const sim = createSimulation(31); let heating = 0;
    for (let n = 0; n < 3 * 60 * TICK_HZ && sim.getSnapshot().phase === 'active'; n++) {
      if (sim.getSnapshot().launchCooldownLeftSeconds <= 0) {
        const shot = sim.submitLaunch(dropAt(0)); if (shot.accepted) heating += shot.heatDelta ?? 0;
      }
      sim.stepFixed();
    }
    expect(heating).toBeGreaterThan(0); expect(sim.getSnapshot().phase).toBe('over');
    const record = createReplayRecord(sim), parsed = parseReplay(serializeReplay(record))!;
    expect(parsed).toEqual(record);
    const replay = createReplayPlayer(parsed); expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.player.seek(record.endTick)).toEqual(sim.getSnapshot());
      replay.player.seek(Math.floor(record.endTick / 2));
      expect(replay.player.seek(record.endTick)).toEqual(sim.getSnapshot());
    }
    const encoded = encodeSimulation(sim), decoded = decodePlay(encoded); expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.play.inputs).toEqual(sim.getInputLog());
    const verified = verifyPlay(encoded); expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.result).toMatchObject({ score: sim.getSnapshot().score, ticks: sim.getSnapshot().tick,
      gameOver: true, stats: sim.getSnapshot().stats, inputsApplied: sim.getInputLog().length });
  });
});
