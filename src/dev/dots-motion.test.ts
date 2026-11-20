import { describe, expect, it } from 'vitest';
import { DT, TICK_HZ } from '../game/constants';
import { createDotsPlayback, createDotsSimulation, dotsTimeScale, interpolateDotsBodies } from './dots-motion';

describe('動く盤面の実計算', () => {
  it('6体から同じ結果の3連鎖になり、消費と誕生のIDがつながる', () => {
    const sim = createDotsSimulation();
    expect(sim.getSnapshot().bodies).toHaveLength(6);
    const events = [];
    for (let tick = 0; tick < TICK_HZ * 4; tick += 1) {
      events.push(...sim.stepFixed().filter(event => event.kind === 'merge'));
    }
    expect(events.map(event => event.chain)).toEqual([1, 2, 3]);
    expect(events.map(event => event.tick)).toEqual([26, 75, 89]);
    expect(events[1]!.bodyIds).toContain(events[0]!.bodyIds![2]);
    expect(events[2]!.bodyIds).toContain(events[1]!.bodyIds![2]);
    expect(sim.getSnapshot().score).toBe(events.reduce((total, event) => total + event.scoreDelta!, 0));
    expect(sim.getSnapshot().score).toBe(1390);
  });

  it('描き方の状態を持たず、再生し直しても同じtick・位置・得点になる', () => {
    const playback = createDotsPlayback();
    const run = () => {
      const states = [];
      for (let frame = 0; frame < 240; frame += 1) states.push(playback.update(1 / 60, false));
      return states.map(state => ({ snapshot: state.snapshot, bodies: state.bodies }));
    };
    const first = run();
    playback.reset();
    expect(run()).toEqual(first);
    expect(first.at(-1)!.snapshot.stats.maxChain).toBe(3);
  });

  it('自動ループで得点と演出の前の周の状態を残さない', () => {
    const playback = createDotsPlayback();
    let frame = playback.update(0, false);
    for (let count = 0; count < TICK_HZ * 6 + 3; count += 1) frame = playback.update(DT, false);
    expect(frame.cycle).toBe(2);
    expect(frame.snapshot.score).toBe(0);
    expect(frame.impacts).toHaveLength(0);
  });

  it('動きを減らすと停止を要求せず、大きい段でも停止要求は150ms以内', () => {
    for (const chain of [1, 2, 3]) {
      let stop = 0;
      for (let n = 0; n < 200; n += 1) {
        const age = n / 1000;
        expect(dotsTimeScale(age, chain, true)).toBe(1);
        if (dotsTimeScale(age, chain, false) === 0) stop += .001;
      }
      expect(stop).toBeLessThanOrEqual(.15);
    }
  });

  it('消費済みの天体は復活させず、存続する天体の位置だけを補間する', () => {
    const sim = createDotsSimulation();
    const before = sim.getSnapshot();
    sim.stepFixed();
    const current = sim.getSnapshot();
    const half = interpolateDotsBodies(before.bodies, current.bodies, .5);
    expect(half.map(body => body.id)).toEqual(current.bodies.map(body => body.id));
    for (const body of half) {
      const p = before.bodies.find(prior => prior.id === body.id)!;
      const c = current.bodies.find(item => item.id === body.id)!;
      expect(body.x).toBeCloseTo((p.x + c.x) / 2);
      expect(body.y).toBeCloseTo((p.y + c.y) / 2);
    }
  });
});
