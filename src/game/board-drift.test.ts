import { describe, expect, it } from 'vitest';
import { driftBoard } from './board-drift';
import { BOARD_ROTATION_RADIANS_PER_SECOND, TICK_HZ } from './constants';
import { createSimulation, restoreSimulation } from './simulation';
import { dropAt } from '../fixtures';
import { createReplayRecord } from '../replay/record';
import { runReplay } from '../replay/engine';

describe('全体の流れ', () => {
  it('距離・大きさ・速度の大きさを変えず、位置と速度の向きを同じだけ回す', () => {
    const a = { x: 100, y: 0, px: 100, py: 0, vx: 30, vy: 0 };
    const b = { x: 200, y: 0, px: 200, py: 0, vx: 0, vy: 50 };
    for (let n = 0; n < TICK_HZ; n++) driftBoard([a, b]);
    expect(Math.atan2(a.y, a.x)).toBeCloseTo(BOARD_ROTATION_RADIANS_PER_SECOND, 10);
    expect(Math.hypot(a.x-b.x, a.y-b.y)).toBeCloseTo(100, 9);
    expect(Math.hypot(a.vx,a.vy)).toBeCloseTo(30, 9); expect(Math.hypot(b.vx,b.vy)).toBeCloseTo(50, 9);
    expect(a.px).toBe(a.x); expect(a.py).toBe(a.y);
  });
  it('飛行中の天体にも同じ流れを入れ、照準の各標本と一致する', () => {
    const sim = createSimulation(31, { bodies: [] }), command = dropAt(-Math.PI/2);
    const p = sim.predict(command); sim.submitLaunch(command);
    for (const point of p.points.slice(1,-1)) {
      while(sim.getSnapshot().tick < Math.round(point.t*TICK_HZ)) sim.stepFixed();
      const body=sim.getSnapshot().bodies[0]!;
      expect(body.x).toBeCloseTo(point.x, 6); expect(body.y).toBeCloseTo(point.y, 6);
    }
  });
  it('最初の一投は合体でき、途中復元と再生も同じ結果を保つ', () => {
    const sim=createSimulation(31); sim.submitLaunch(dropAt(-Math.PI/2));
    for(let n=0;n<60;n++) sim.stepFixed();
    const copy=restoreSimulation(sim.exportState());
    for(let n=0;n<2*TICK_HZ;n++) expect(copy.stepFixed()).toEqual(sim.stepFixed());
    expect(sim.getSnapshot().stats.merges).toBeGreaterThan(0);
    expect(copy.getSnapshot()).toEqual(sim.getSnapshot());
    const replay=runReplay(createReplayRecord(sim)); expect(replay.ok).toBe(true);
    if(replay.ok) expect(replay.final).toEqual(sim.getSnapshot());
  });
});
