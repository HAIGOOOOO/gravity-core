import { expect, it } from 'vitest';
import { TICK_HZ } from '../game/constants';
import { dropAt } from '../fixtures';
import { createReplayRecord } from './record';
import { createReplayPlayer } from './player';
import { runReplay } from './engine';
import { createReplayCapture } from './capture';
import { createResultSample } from '../dev/replay-result-sample';
import { highlightsFromRun } from './highlights';
import { causeFromRun } from './cause';

it('6分間、入力を足し続けた記録の準備を測る', { timeout: 60000 }, () => {
  const capture = createReplayCapture(7);
  const sim = capture.simulation;
  const endTick = 6 * 60 * TICK_HZ;
  for (let tick = 0; tick < endTick; tick++) {
    if (tick % (8 * TICK_HZ) === 0) sim.submitLaunch(dropAt(-Math.PI / 2));
    sim.stepFixed();
  }
  const record = createReplayRecord(sim);
  expect(record.endTick).toBe(endTick);
  const t = performance.now();
  const captured = capture.finish();
  const resultMs = performance.now() - t;
  expect(resultMs).toBeLessThan(2000);
  const fullBegan = performance.now();
  const run = runReplay(record, { checkpointEvery: 0 });
  const summaryMs = performance.now() - fullBegan;
  const began = performance.now();
  const start = createReplayPlayer(record);
  console.log({ resultMs, summaryMs, playerMs: performance.now() - began, launches: record.inputs.length, bodies: record.finalBodyCount });
  expect(run.ok).toBe(true); expect(start.ok).toBe(true);
  const fast = captured.createPlayer();
  expect(fast.ok).toBe(true);
  if (fast.ok) expect(fast.player.seek(record.endTick)).toEqual(sim.getSnapshot());
});

it('6分以上遊んで負けた結果を2秒以内に取り出し、再検証の結果と一致する', { timeout: 60000 }, () => {
  const capture = createResultSample();
  const end = capture.simulation.getSnapshot();
  expect(end.tick).toBeGreaterThanOrEqual(6 * 60 * TICK_HZ);
  expect(end.phase).toBe('over');
  const began = performance.now();
  const result = capture.finish();
  const resultMs = performance.now() - began;
  expect(resultMs).toBeLessThan(2000);
  expect(result.highlights.length).toBeGreaterThan(0);
  expect(result.cause?.culprits.length).toBeGreaterThan(0);
  const player = result.createPlayer();
  expect(player.ok).toBe(true);
  if (!player.ok) return;
  expect(player.player.memory.keyframes).toBeLessThanOrEqual(722);
  const verified = runReplay(result.record, { checkpointEvery: 0 });
  expect(verified.ok).toBe(true);
  if (!verified.ok) return;
  expect(result.highlights).toEqual(highlightsFromRun(verified));
  expect(result.cause).toEqual(causeFromRun(verified));
  expect(player.player.seek(end.tick)).toEqual(verified.final);
  // 保存点を間引いた後の盤面も、先頭から計算した真値と比較する。
  const target = end.tick - 73;
  let truth = '';
  runReplay(result.record, { checkpointEvery: 0, visit: (snapshot) => {
    if (snapshot.tick === target) truth = JSON.stringify(snapshot);
  } });
  const seekBegan = performance.now();
  const replayed = player.player.seek(target);
  const seekMs = performance.now() - seekBegan;
  expect(JSON.stringify(replayed)).toBe(truth);
  expect(seekMs).toBeLessThan(200);
  console.log(`[result] ${(end.tick / TICK_HZ).toFixed(2)}s launches=${result.record.inputs.length}, result=${resultMs.toFixed(2)}ms seek=${seekMs.toFixed(2)}ms`);
});
