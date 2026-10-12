import { describe, expect, it } from 'vitest';
import type { GameEvent, GravityCommand, GravityInput, LaunchInput } from '../contracts/game';
import { dropAt } from '../fixtures';
import { TICK_HZ } from './constants';
import { defaultGravityTuning } from './gravity';
import { createRng } from './rng';
import { createSimulation } from './simulation';

type Script = (tick: number) => GravityCommand | null;

/** 勝手に落とし続けながら、決めた tick に重力操作を入れる。 */
function play(seed: number, ticks: number, script: Script, withGravity = true) {
  const sim = createSimulation(seed, undefined, withGravity ? defaultGravityTuning() : undefined);
  const rng = createRng(seed + 1);
  const events: GameEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    if (t % 110 === 60) sim.submitLaunch(dropAt(rng() * Math.PI * 2));
    const command = script(t);
    if (command) sim.submitGravity(command);
    events.push(...sim.stepFixed());
  }
  return { sim, events };
}

/** 入力の記録だけから、同じ回をやり直す。 */
function replay(seed: number, ticks: number, launches: readonly LaunchInput[], gravity: readonly GravityInput[]) {
  const sim = createSimulation(seed, undefined, defaultGravityTuning());
  const events: GameEvent[] = [];
  let li = 0;
  let gi = 0;
  for (let t = 0; t < ticks; t++) {
    while (li < launches.length && launches[li]!.tick === t) sim.submitLaunch(launches[li++]!);
    while (gi < gravity.length && gravity[gi]!.tick === t) sim.submitGravity(gravity[gi++]!.command);
    events.push(...sim.stepFixed());
  }
  return { sim, events };
}

const TICKS = 40 * TICK_HZ;

const SCRIPTS: Record<string, Script> = {
  握る: (t) => (t % 600 === 300 ? { kind: 'grip', on: true } : t % 600 === 400 ? { kind: 'grip', on: false } : null),
  井戸: (t) => (t % 500 === 250 ? { kind: 'well', x: 260 * Math.cos(t), y: 260 * Math.sin(t) } : null),
  渦: (t) =>
    t % 700 === 300 ? { kind: 'vortex', dir: t % 1400 === 300 ? 1 : -1 } : t % 700 === 380 ? { kind: 'vortex', dir: 0 } : null,
};

describe('重力操作の決定性', () => {
  for (const [name, script] of Object.entries(SCRIPTS)) {
    it(`${name}: 同じシードと同じ入力の記録なら、同じ結果になる`, () => {
      const a = play(11, TICKS, script);
      const log = a.sim.getGravityLog();
      expect(log.length).toBeGreaterThan(0);
      const b = replay(11, TICKS, a.sim.getInputLog(), log);
      expect(b.sim.getSnapshot()).toEqual(a.sim.getSnapshot());
      expect(b.events).toEqual(a.events);
      expect(b.sim.getGravityLog()).toEqual(log);
    });
  }
});

describe('重力操作を使わないとき', () => {
  it('重力操作を有効にしても、使わなければ今までと 1 tick も違わない', () => {
    const plain = play(7, TICKS, () => null, false);
    const enabled = play(7, TICKS, () => null, true);
    const { gravity: _unused, ...rest } = enabled.sim.getSnapshot();
    expect(rest).toEqual(plain.sim.getSnapshot());
    expect(enabled.events).toEqual(plain.events);
    expect(enabled.sim.getInputLog()).toEqual(plain.sim.getInputLog());
  });

  it('無効の計算では受け付けず、記録にも残らない', () => {
    const sim = createSimulation(1);
    expect(sim.submitGravity({ kind: 'grip', on: true })).toEqual({ accepted: false, reason: 'disabled' });
    expect(sim.getGravityLog()).toHaveLength(0);
    expect(sim.getSnapshot().gravity).toBeUndefined();
  });
});

describe('重力操作の歯止め', () => {
  it('握りっぱなしでも自動で離れ、握っている間は熱量が上がる', () => {
    const sim = createSimulation(1, undefined, defaultGravityTuning());
    sim.submitGravity({ kind: 'grip', on: true });
    for (let i = 0; i < 4 * TICK_HZ; i++) sim.stepFixed();
    const s = sim.getSnapshot();
    expect(s.gravity?.grip.held).toBe(false);
    expect(s.bodies.every((b) => Math.hypot(b.x, b.y) < 430)).toBe(true);
    expect(sim.getGravityLog()).toHaveLength(1);
  });

  it('渦は離すと止まり、止まれば熱量は冷める', () => {
    const sim = createSimulation(1, undefined, defaultGravityTuning());
    sim.submitGravity({ kind: 'vortex', dir: 1 });
    for (let i = 0; i < TICK_HZ; i++) sim.stepFixed();
    const hot = sim.getSnapshot().heat;
    expect(hot).toBeGreaterThan(0);
    sim.submitGravity({ kind: 'vortex', dir: 0 });
    for (let i = 0; i < 3 * TICK_HZ; i++) sim.stepFixed();
    expect(sim.getSnapshot().gravity?.vortex.spin).toBe(0);
    expect(sim.getSnapshot().heat).toBeLessThan(hot);
  });

  it('井戸は持ち数が無ければ置けず、同時に 2 つは置けない', () => {
    const sim = createSimulation(1, undefined, defaultGravityTuning());
    expect(sim.submitGravity({ kind: 'well', x: 0, y: 0 })).toEqual({ accepted: false, reason: 'outOfBoard' });
    expect(sim.submitGravity({ kind: 'well', x: 250, y: 0 }).accepted).toBe(true);
    expect(sim.submitGravity({ kind: 'well', x: -250, y: 0 })).toEqual({ accepted: false, reason: 'busy' });
    for (let i = 0; i < 6 * TICK_HZ; i++) sim.stepFixed();
    expect(sim.getSnapshot().gravity?.well).toBeNull();
    expect(sim.submitGravity({ kind: 'well', x: -250, y: 0 })).toEqual({ accepted: false, reason: 'noCharge' });
    expect(sim.getGravityLog()).toHaveLength(1);
  });
});
