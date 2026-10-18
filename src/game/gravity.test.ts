import { describe, expect, it } from 'vitest';
import type { GameEvent, GravityCommand, GravityInput, LaunchInput } from '../contracts/game';
import { dropAt } from '../fixtures';
import { TICK_HZ } from './constants';
import { defaultGravityTuning } from './gravity';
import { createRng } from './rng';
import { createSimulation, restoreSimulation } from './simulation';

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
  it('握りっぱなしでは自動で離れず、ふくらみは止まり、熱量は上がり続ける', () => {
    const sim = createSimulation(1, undefined, defaultGravityTuning());
    sim.submitGravity({ kind: 'grip', on: true });
    for (let i = 0; i < 2.5 * TICK_HZ; i++) sim.stepFixed(); // 最長 1.4 秒を越えて握る（熱量 100 の手前まで）
    const s = sim.getSnapshot();
    expect(s.gravity?.grip.held).toBe(true);
    expect(s.gravity?.grip.charge).toBe(1);
    expect(s.heat).toBeGreaterThan(55);
    // ふくらむだけでは限界リングを越えない
    expect(s.bodies.every((b) => Math.hypot(b.x, b.y) + b.radius <= 320)).toBe(true);
    // 締まるのは離した時
    expect(sim.submitGravity({ kind: 'grip', on: false }).accepted).toBe(true);
    sim.stepFixed();
    expect(sim.getSnapshot().gravity?.grip.squeezeLeftSeconds).toBeGreaterThan(0);
    expect(sim.getGravityLog()).toHaveLength(2);
  });

  it('短すぎる握り（タップ）は締まらない', () => {
    const sim = createSimulation(1, undefined, defaultGravityTuning());
    sim.submitGravity({ kind: 'grip', on: true });
    sim.stepFixed();
    sim.submitGravity({ kind: 'grip', on: false });
    sim.stepFixed();
    const g = sim.getSnapshot().gravity!;
    expect(g.grip.squeezeLeftSeconds).toBe(0);
    expect(g.coolingBlocked).toBe(false);
    // すぐにまた握れる
    expect(sim.submitGravity({ kind: 'grip', on: true }).accepted).toBe(true);
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

describe('重力操作の途中の書き出しと復元', () => {
  it('握り・井戸・渦の最中に書き出しても、復元した先は元と全く同じになる', () => {
    const script: Script = (t) =>
      t === 300 ? { kind: 'grip', on: true }
      : t === 360 ? { kind: 'grip', on: false }
      : t === 700 ? { kind: 'well', x: 120, y: -80 }
      : t === 1000 ? { kind: 'vortex', dir: 1 }
      : t === 1200 ? { kind: 'vortex', dir: 0 }
      : null;
    for (const cut of [330, 380, 760, 1100, 1250]) {
      const { sim } = play(17, cut, script);
      const restored = restoreSimulation(sim.exportState());
      const rngA = createRng(99);
      const rngB = createRng(99);
      for (let t = cut; t < cut + 600; t++) {
        const command = script(t);
        if (t % 110 === 60) {
          sim.submitLaunch(dropAt(rngA() * Math.PI * 2));
          restored.submitLaunch(dropAt(rngB() * Math.PI * 2));
        }
        if (command) expect(restored.submitGravity(command)).toEqual(sim.submitGravity(command));
        expect(restored.stepFixed()).toEqual(sim.stepFixed());
      }
      expect(restored.getSnapshot()).toEqual(sim.getSnapshot());
      expect(restored.getGravityLog()).toEqual(sim.getGravityLog());
    }
  });
});
