import { describe, expect, it } from 'vitest';
import { HEAT_STATE_LIMITS, TICK_HZ } from '../game/constants';
import { at, createAutoPlay, dropAt } from '../fixtures';
import { createSimulation } from '../game/simulation';
import { createReplayPlayer } from './player';
import { createReplayRecord, snapshotHash } from './record';
import { findHighlights } from './highlights';
import { analyzeCause } from './cause';

describe('復元する再生と共通の解析', () => {
  it('入力を受け付ける保存点の前後へ往復しても盤面と出来事が一致する', () => {
    const sim = createSimulation(13);
    const truth = new Map<number, string>();
    for (let tick = 0; tick <= 1500; tick++) {
      truth.set(tick, snapshotHash(sim.getSnapshot()));
      if (tick === 1500) break;
      if (tick % 60 === 0) sim.submitLaunch(dropAt(-Math.PI / 2 + tick / 60));
      sim.stepFixed();
    }
    const start = createReplayPlayer(createReplayRecord(sim));
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    for (const target of [1499, 61, 901, 59, 1201, 60, 899, 1, 1500, 0, 1481]) {
      expect(snapshotHash(start.player.seek(target)), `tick ${target}`).toBe(truth.get(target));
    }
  });

  it('臨界の境目ちょうどを拾い、共有の解析と単独の解析が一致する', () => {
    const setup = { heat: HEAT_STATE_LIMITS[2], bodies: [at(7, 130, 0), at(6, 280, 0), at(5, 400, 0)] };
    const sim = createSimulation(1, setup);
    while (sim.getSnapshot().phase === 'active') sim.stepFixed();
    const record = createReplayRecord(sim, { setup });
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.player.highlights.find((h) => h.kind === 'heatCritical')).toEqual({
      kind: 'heatCritical', tick: 0, value: HEAT_STATE_LIMITS[2],
    });
    const highlights = findHighlights(record);
    const cause = analyzeCause(record);
    expect(highlights.ok && highlights.highlights).toEqual(start.player.highlights);
    expect(cause.ok && cause.cause).toEqual(start.player.cause);
  });

  it('10 分の記録で未訪問の前後 40 地点へ 200ms 以内で正確に飛ぶ', { timeout: 60000 }, () => {
    // 最初の 30 秒は自動投入し、その後も実物の物理で 10 分まで進める。
    const auto = createAutoPlay(7);
    const endTick = 10 * 60 * TICK_HZ;
    const targets = Array.from({ length: 40 }, (_, i) => 1 + Math.floor((endTick - 2) * i / 40));
    const truth = new Map<number, string>();
    for (let tick = 0; tick < endTick; tick++) {
      if (targets.includes(tick)) truth.set(tick, snapshotHash(auto.sim.getSnapshot()));
      if (tick < 30 * TICK_HZ) auto.step();
      else auto.sim.stepFixed();
    }
    const record = createReplayRecord(auto.sim);
    expect(record.endTick).toBe(endTick);
    const began = performance.now();
    const start = createReplayPlayer(record);
    const createMs = performance.now() - began;
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    let maxMs = 0;
    const seeks: number[] = [];
    for (let i = 0; i < targets.length / 2; i++) seeks.push(targets[targets.length - 1 - i]!, targets[i]!);
    for (const target of seeks) {
      const began = performance.now();
      const snapshot = start.player.seek(target);
      maxMs = Math.max(maxMs, performance.now() - began);
      expect(snapshotHash(snapshot), `tick ${target}`).toBe(truth.get(target));
    }
    expect(maxMs).toBeLessThan(200);
    console.log(`[replay] 10min launches=${record.inputs.length} create=${createMs.toFixed(1)}ms worstSeek=${maxMs.toFixed(2)}ms memory=${start.player.memory.approxBytes}B`);
  });
});
