// 途中の盤面の書き出し・復元（exportState / restoreSimulation）と、射出の値の丸め（quantizeLaunch）。
import { describe, expect, it } from 'vitest';
import type { GameEvent, LaunchCommand } from '../contracts/game';
import { aimVelocity } from '../shared/launch';
import { decodePlay, encodeSimulation } from '../share/codec';
import { CHAIN_GRACE_SECONDS, SPEED_MAX, TICK_HZ } from './constants';
import { predictLaunch, quantizeLaunch } from './predictor';
import { createRng } from './rng';
import { createSimulation, restoreSimulation, type Simulation } from './simulation';

/** 決まった種で、投げる・落とすを混ぜて撃ち続ける（人の入力に近い、格子に乗らない値）。 */
function commandAt(n: number, rng: () => number): LaunchCommand {
  const angle = rng() * Math.PI * 2 - Math.PI; // 負の角度も混ぜる
  const speed = 200 + rng() * (SPEED_MAX - 200);
  const turn = (rng() - 0.5) * 1.2; // 核からずらして投げる
  const dir = angle + Math.PI + turn;
  return n % 3 === 0
    ? { originAngleRadians: angle, vx: -Math.cos(angle) * 260, vy: -Math.sin(angle) * 260 }
    : { originAngleRadians: angle, vx: Math.cos(dir) * speed, vy: Math.sin(dir) * speed };
}

/** ticks ぶん進める。種 inputSeed の撃ち方を tick 番号で決めるので、途中から始めても同じ入力になる。 */
function advance(sim: Simulation, ticks: number, inputSeed: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const t = sim.getSnapshot().tick;
    if (t % 70 === 10) {
      const rng = createRng(inputSeed * 100_003 + t);
      sim.submitLaunch(commandAt(t, rng));
    }
    events.push(...sim.stepFixed());
  }
  return events;
}

describe('途中の盤面の書き出しと復元', () => {
  it('書き出した所から復元すると、その先は元と全く同じになる', () => {
    const a = createSimulation(11);
    advance(a, 40 * TICK_HZ, 3);
    const saved = a.exportState();
    const b = restoreSimulation(saved);
    expect(b.getSnapshot()).toEqual(a.getSnapshot());
    const ea = advance(a, 40 * TICK_HZ, 3);
    const eb = advance(b, 40 * TICK_HZ, 3);
    expect(eb).toEqual(ea);
    expect(b.getSnapshot()).toEqual(a.getSnapshot());
    expect(b.getInputLog()).toEqual(a.getInputLog());
    expect(a.getSnapshot().stats.launches).toBeGreaterThan(30);
  });

  it('射出の直後（イベントがまだ出ていない時）に書き出しても、launch のイベントが失われない', () => {
    const a = createSimulation(4, { bodies: [], queue: [0, 1, 2] });
    a.stepFixed();
    expect(a.submitLaunch({ originAngleRadians: 0.5, vx: -200, vy: -100 }).accepted).toBe(true);
    const b = restoreSimulation(a.exportState());
    expect(b.stepFixed()).toEqual(a.stepFixed());
  });

  it('書き出した後に本体を進めても、書き出した物は変わらない', () => {
    const a = createSimulation(7);
    advance(a, 5 * TICK_HZ, 2);
    const saved = a.exportState();
    const copy = structuredClone(saved);
    advance(a, 10 * TICK_HZ, 2);
    expect(saved).toEqual(copy);
    // 同じ書き出しから 2 回復元しても、互いに影響しない
    const b = restoreSimulation(saved);
    const c = restoreSimulation(saved);
    advance(b, 3 * TICK_HZ, 9);
    expect(c.getSnapshot().tick).toBe(saved.tick);
  });

  it('終わったゲームも書き出して復元できる', () => {
    const a = createSimulation(1, {
      heat: 99,
      // 大きい 2 体を縦に積み、上の天体が限界リングをはみ出すようにする
      bodies: [
        { tier: 8, x: 0, y: -144 },
        { tier: 7, x: 0, y: -326 },
      ],
    });
    for (let i = 0; i < 10 * TICK_HZ && a.getSnapshot().phase !== 'over'; i++) a.stepFixed();
    expect(a.getSnapshot().phase).toBe('over');
    const b = restoreSimulation(a.exportState());
    expect(b.getSnapshot()).toEqual(a.getSnapshot());
    expect(b.stepFixed()).toEqual([]);
  });
});

describe('射出の値の丸め', () => {
  it('入力ログには丸めた値が残り、角度は 0 以上 2π 未満、速度は整数', () => {
    const sim = createSimulation(2);
    advance(sim, 60 * TICK_HZ, 5);
    const log = sim.getInputLog();
    expect(log.length).toBeGreaterThan(30);
    for (const input of log) {
      expect(input.originAngleRadians).toBeGreaterThanOrEqual(0);
      expect(input.originAngleRadians).toBeLessThan(Math.PI * 2);
      expect(Number.isInteger(input.vx) && Number.isInteger(input.vy)).toBe(true);
      expect(Object.is(input.vx, -0) || Object.is(input.vy, -0)).toBe(false);
      expect(quantizeLaunch(input)).toEqual({ originAngleRadians: input.originAngleRadians, vx: input.vx, vy: input.vy });
    }
  });

  it('照準の予測と実際の射出は、同じ丸めた値を使う', () => {
    // 丸めのずれは 1 px/秒以下なので、物理の結果で比べても見分けられない。値そのもので確かめる
    const sim = createSimulation(3, { bodies: [], queue: [0, 0, 0] });
    const raw = { originAngleRadians: -1.234567, vx: 123.4, vy: 456.6 };
    const before = sim.getSnapshot();
    const prediction = sim.predict(raw);
    expect(sim.submitLaunch(raw).accepted).toBe(true);
    const logged = sim.getInputLog()[0]!;
    const used = { originAngleRadians: logged.originAngleRadians, vx: logged.vx, vy: logged.vy };
    expect(used).toEqual(quantizeLaunch(raw));
    expect(prediction).toEqual(predictLaunch(before, used));
    expect(prediction).not.toEqual(predictLaunch(before, raw));
  });

  it('速さの上限ちょうどで引いた射出は、丸めても断られない', () => {
    for (let i = 0; i < 64; i++) {
      const angle = (i / 64) * Math.PI * 2;
      const sim = createSimulation(1, { bodies: [], queue: [0, 0, 0] });
      // 核へ向けて、横へ大きくずらし、速さを上限ちょうどにする
      const dir = angle + Math.PI + 1.2 * ((i % 2) * 2 - 1);
      const res = sim.submitLaunch({ originAngleRadians: angle, vx: Math.cos(dir) * SPEED_MAX, vy: Math.sin(dir) * SPEED_MAX });
      expect(res.accepted, `角度 ${angle}`).toBe(true);
    }
  });

  it('引っぱりの入力（aimVelocity）から作った射出も受け付けられる', () => {
    const sim = createSimulation(1, { bodies: [], queue: [0, 0, 0] });
    const angle = 2.0;
    const v = aimVelocity(angle, 150, 0.3);
    if (v) expect(sim.submitLaunch({ originAngleRadians: angle, ...v }).accepted).toBe(true);
  });
});

describe('共有の文字列の長さ（人の入力に近い射出）', () => {
  it('投げると落とすを混ぜた 152 投が 2,000 文字に入り、読み戻すと同じ入力になる', () => {
    const sim = createSimulation(21);
    let guard = 0;
    while (sim.getSnapshot().stats.launches < 152 && sim.getSnapshot().phase !== 'over' && guard++ < 400 * TICK_HZ) {
      advance(sim, 1, 8);
    }
    const text = encodeSimulation(sim);
    const decoded = decodePlay(text);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.play.inputs).toEqual(sim.getInputLog());
    const perLaunch = text.length / sim.getInputLog().length;
    expect(perLaunch * 152).toBeLessThan(2000);
  });
});

describe('連鎖の見えない猶予', () => {
  /** 連鎖 1 を持つ天体と、同じ Tier の天体が次の tick で触れる盤面を、期限からのずれ late（tick）で作る。 */
  function mergeChainAt(late: number): number | undefined {
    const base = createSimulation(1, { bodies: [{ tier: 2, x: 0, y: -69 }, { tier: 2, x: 0, y: -119 }], queue: [0, 0, 0] });
    const saved = base.exportState();
    const tick = saved.tick;
    const bodies = saved.bodies.map((b, i) => (i === 0 ? { ...b, chain: 1, chainUntilTick: tick + 1 - late } : b));
    const sim = restoreSimulation({ ...saved, bodies });
    const merge = sim.stepFixed().find((e) => e.kind === 'merge');
    return merge?.chain;
  }

  it('期限ちょうどと、猶予の中は連鎖に数える', () => {
    expect(mergeChainAt(0)).toBe(2);
    expect(mergeChainAt(Math.round(CHAIN_GRACE_SECONDS * TICK_HZ))).toBe(2);
  });

  it('猶予を過ぎたら数えない', () => {
    expect(mergeChainAt(Math.round(CHAIN_GRACE_SECONDS * TICK_HZ) + 1)).toBe(1);
  });
});
