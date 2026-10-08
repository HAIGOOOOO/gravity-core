import { describe, expect, it } from 'vitest';
import type { GameEvent, LaunchCommand, SimulationPort, Tier } from '../contracts/game';
import { aimVelocity } from '../shared/launch';
import {
  CORE_RADIUS,
  DROP_SPEED,
  HEAT_COOL_PER_SECOND,
  HEAT_RISE_PER_SECOND,
  LAUNCH_RADIUS,
  LIMIT_RADIUS,
  SPEED_MAX,
  SPEED_MIN,
  TICK_HZ,
  TIER_BASE_SCORE,
  TIER_RADIUS,
} from './constants';
import { createRng } from './rng';
import { chainMultiplier, createSimulation } from './simulation';
import { drawTier } from './spawner';

const UP = -Math.PI / 2;

function drop(angle: number): LaunchCommand {
  return { originAngleRadians: angle, vx: -Math.cos(angle) * DROP_SPEED, vy: -Math.sin(angle) * DROP_SPEED };
}

function run(sim: SimulationPort, ticks: number): GameEvent[] {
  const all: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) all.push(...sim.stepFixed());
  return all;
}

/** 角度 angle の方向、中心から距離 r に置く。 */
function at(tier: Tier, r: number, angle: number) {
  return { tier, x: r * Math.cos(angle), y: r * Math.sin(angle) };
}

describe('落ちて積もる', () => {
  it('落とした天体は核の表面で止まる', () => {
    const sim = createSimulation(1, { bodies: [], queue: [2, 0, 0] });
    expect(sim.submitLaunch(drop(0.3)).accepted).toBe(true);
    const events = run(sim, 3 * TICK_HZ);
    const b = sim.getSnapshot().bodies[0]!;
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(CORE_RADIUS + TIER_RADIUS[2], 0);
    expect(Math.hypot(b.vx, b.vy)).toBe(0);
    expect(events.filter((e) => e.kind === 'land')).toHaveLength(1);
  });

  it('違う Tier は合体せず、重ならずに積もる', () => {
    const sim = createSimulation(1, { bodies: [at(3, CORE_RADIUS + 32, UP)], queue: [1, 0, 0] });
    sim.submitLaunch(drop(UP));
    const events = run(sim, 4 * TICK_HZ);
    const [a, b] = sim.getSnapshot().bodies;
    expect(sim.getSnapshot().bodies).toHaveLength(2);
    expect(events.some((e) => e.kind === 'merge')).toBe(false);
    expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeGreaterThan(a!.radius + b!.radius - 1);
    expect(sim.getSnapshot().score).toBe(0);
  });

  it('30 体を落としても、重なりが残らず、全部止まる', () => {
    const sim = createSimulation(9, { bodies: [] });
    const rng = createRng(4);
    for (let i = 0; i < 30; i++) {
      sim.submitLaunch(drop(rng() * Math.PI * 2));
      run(sim, 70);
    }
    run(sim, 6 * TICK_HZ);
    const bodies = sim.getSnapshot().bodies;
    let worst = 0;
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i]!;
        const b = bodies[j]!;
        worst = Math.max(worst, a.radius + b.radius - Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    expect(worst).toBeLessThan(1.5);
    expect(Math.max(...bodies.map((b) => Math.hypot(b.vx, b.vy)))).toBeLessThan(30);
  });

  it('同じシードと同じ射出なら結果が完全に一致する', () => {
    const play = () => {
      const sim = createSimulation(42);
      for (let i = 0; i < 2000; i++) {
        if (i % 90 === 10) sim.submitLaunch(drop(i * 0.37));
        sim.stepFixed();
      }
      return JSON.stringify(sim.getSnapshot());
    };
    expect(play()).toBe(play());
  });
});

describe('合体', () => {
  it('同じ Tier が触れると 1 つ上の Tier が 1 体だけ生まれ、基礎点が入る', () => {
    for (let tier = 0 as Tier; tier < 8; tier = (tier + 1) as Tier) {
      const r = TIER_RADIUS[tier];
      const sim = createSimulation(1, {
        bodies: [
          { tier, x: 200, y: 0 },
          { tier, x: 200 + 2 * r, y: 0 },
        ],
      });
      const events = run(sim, 2);
      const snap = sim.getSnapshot();
      expect(snap.bodies).toHaveLength(1);
      expect(snap.bodies[0]!.tier).toBe(tier + 1);
      expect(snap.score).toBe(TIER_BASE_SCORE[tier]);
      expect(events.filter((e) => e.kind === 'merge')).toHaveLength(1);
    }
  });

  it('生まれた天体は、少しずつ本来の大きさになる', () => {
    const sim = createSimulation(1, { bodies: [at(0, 200, 0), at(0, 228, 0)] });
    run(sim, 2);
    expect(sim.getSnapshot().bodies[0]!.radius).toBeLessThan(TIER_RADIUS[1]);
    run(sim, 30);
    expect(sim.getSnapshot().bodies[0]!.radius).toBe(TIER_RADIUS[1]);
  });

  it('3 体が同時に触れても 1 体が 2 回合体しない', () => {
    const sim = createSimulation(1, { bodies: [at(0, 200, 0), at(0, 228, 0), at(0, 256, 0)] });
    const events = run(sim, 1);
    expect(events.filter((e) => e.kind === 'merge')).toHaveLength(1);
    expect(sim.getSnapshot().bodies).toHaveLength(2);
  });

  it('連鎖: 生まれた天体がすぐまた合体すると連鎖 2 になり、得点が 1.5 倍', () => {
    // Tier 0 が 2 体合体 → Tier 1 が生まれ、隣の Tier 1 と合体する
    const sim = createSimulation(1, {
      bodies: [at(0, CORE_RADIUS + 14, UP), at(0, CORE_RADIUS + 42, UP), at(1, CORE_RADIUS + 19, UP + 0.58)],
    });
    const merges = run(sim, 3 * TICK_HZ).filter((e) => e.kind === 'merge');
    expect(merges.map((e) => e.chain)).toEqual([1, 2]);
    expect(merges[1]!.scoreDelta).toBe(Math.round(TIER_BASE_SCORE[1] * 1.5));
    expect(sim.getSnapshot().stats.maxChain).toBe(2);
    expect(sim.getSnapshot().bestTierThisRun).toBe(2);
  });

  it('倍率は 1.0 から 0.5 ずつ上がり 3.0 で止まる', () => {
    expect([1, 2, 3, 4, 5, 9].map(chainMultiplier)).toEqual([1, 1.5, 2, 2.5, 3, 3]);
  });

  it('Tier 8 どうしは超新星になり、消えて熱量が下がる', () => {
    const sim = createSimulation(1, { bodies: [at(8, 150, 0), at(8, 350, 0)], heat: 60 });
    const events = run(sim, 1);
    expect(sim.getSnapshot().bodies).toHaveLength(0);
    expect(sim.getSnapshot().score).toBe(45000);
    expect(events.find((e) => e.kind === 'supernova')?.heatDelta).toBe(-40);
    expect(sim.getSnapshot().heat).toBeLessThan(21);
  });
});

describe('限界リングと熱量', () => {
  it('山が限界リングを越えている間だけ熱量が上がり、戻ると下がる', () => {
    // 核の上に大きい天体を縦に積んで、限界リングを越えさせる
    const sim = createSimulation(1, { bodies: [at(7, 130, 0), at(6, 280, 0), at(5, 400, 0)], bestTier: 8 });
    const events = run(sim, 3 * TICK_HZ);
    expect(events.some((e) => e.kind === 'overLimitStart')).toBe(true);
    const snap = sim.getSnapshot();
    expect(snap.overLimit).toBe(true);
    expect(snap.bodies.some((b) => b.overLimit)).toBe(true);
    expect(snap.heat).toBeGreaterThan(HEAT_RISE_PER_SECOND);
  });

  it('越えた天体がなければ毎秒下がり、0 より下がらない', () => {
    const sim = createSimulation(1, { bodies: [at(0, 60, 0)], heat: 30 });
    run(sim, TICK_HZ);
    expect(sim.getSnapshot().heat).toBeCloseTo(30 - HEAT_COOL_PER_SECOND, 1);
    run(sim, 5 * TICK_HZ);
    expect(sim.getSnapshot().heat).toBe(0);
  });

  it('撃った直後の天体は、限界リングの外にいても数えない', () => {
    const sim = createSimulation(1, { bodies: [] });
    sim.submitLaunch(drop(0));
    expect(LAUNCH_RADIUS).toBeGreaterThan(LIMIT_RADIUS);
    const events = run(sim, 2 * TICK_HZ);
    expect(events.some((e) => e.kind === 'overLimitStart')).toBe(false);
    expect(sim.getSnapshot().heat).toBe(0);
  });

  it('熱量 100 で gameOver が 1 回だけ出て、以降は進まない', () => {
    const sim = createSimulation(1, { bodies: [at(7, 130, 0), at(6, 280, 0), at(5, 400, 0)], heat: 95, bestTier: 8 });
    const events = run(sim, 4 * TICK_HZ);
    expect(events.filter((e) => e.kind === 'gameOver')).toHaveLength(1);
    expect(sim.getSnapshot().phase).toBe('over');
    expect(sim.getSnapshot().heat).toBe(100);
    expect(sim.stepFixed()).toEqual([]);
    expect(sim.submitLaunch(drop(1))).toEqual({ accepted: false, reason: 'gameOver' });
  });
});

describe('射出', () => {
  it('成功するとキューの先頭が減り、待ち時間中は断られる', () => {
    const sim = createSimulation(7, { bodies: [], queue: [1, 0, 2] });
    expect(sim.submitLaunch(drop(1)).accepted).toBe(true);
    const snap = sim.getSnapshot();
    expect(snap.nextQueue[0]).toBe(0);
    expect(snap.nextQueue[1]).toBe(2);
    expect(snap.bodies[0]!.tier).toBe(1);
    expect(sim.submitLaunch(drop(2))).toEqual({ accepted: false, reason: 'cooldown' });
    expect(sim.getSnapshot().nextQueue).toEqual(snap.nextQueue);
    run(sim, 61);
    expect(sim.submitLaunch(drop(2)).accepted).toBe(true);
  });

  it('速度が範囲外・外向き・射出点が重なる場合は断られ、キューが減らない', () => {
    const sim = createSimulation(7, { bodies: [{ tier: 4, x: LAUNCH_RADIUS, y: 0 }] });
    expect(sim.submitLaunch({ originAngleRadians: 1, vx: 0, vy: -50 })).toEqual({ accepted: false, reason: 'speed' });
    expect(sim.submitLaunch({ originAngleRadians: 1, vx: 0, vy: SPEED_MAX + 50 })).toEqual({ accepted: false, reason: 'speed' });
    expect(sim.submitLaunch({ originAngleRadians: 0, vx: 300, vy: 0 })).toEqual({ accepted: false, reason: 'speed' });
    expect(sim.submitLaunch(drop(0))).toEqual({ accepted: false, reason: 'overlap' });
    expect(sim.getSnapshot().stats.launches).toBe(0);
    expect(sim.getInputLog()).toHaveLength(0);
  });

  it('開始時の盤面で真上から落とすと、最初の 1 射で合体する', () => {
    const sim = createSimulation(3);
    sim.submitLaunch(drop(UP));
    const events = run(sim, 2 * TICK_HZ);
    expect(events.some((e) => e.kind === 'merge')).toBe(true);
  });

  it('ドラッグが短ければまっすぐ落とし、長ければその向きへ投げる。外向きには投げない', () => {
    const straight = aimVelocity(0, 5, 3);
    expect(straight.straight).toBe(true);
    expect(straight.vx).toBeCloseTo(-DROP_SPEED);
    expect(straight.vy).toBeCloseTo(0);

    const thrown = aimVelocity(0, 0, 200);
    expect(thrown.straight).toBe(false);
    expect(thrown.speed).toBe(SPEED_MAX);
    expect(thrown.vy).toBeCloseTo(SPEED_MAX);

    expect(aimVelocity(0, 0, 24).speed).toBe(SPEED_MIN);
    const outward = aimVelocity(0, 100, 100);
    expect(outward.vx).toBeCloseTo(0);
    expect(outward.vy).toBeGreaterThan(0);
  });
});

describe('次の天体', () => {
  it('抽選確率が到達 Tier ごとに表どおり', () => {
    const cases: [number, number[]][] = [
      [0, [0.7, 0.3]],
      [2, [0.45, 0.35, 0.2]],
      [3, [0.35, 0.3, 0.2, 0.15]],
      [8, [0.3, 0.25, 0.2, 0.15, 0.1]],
    ];
    for (const [best, weights] of cases) {
      const rng = createRng(best + 1);
      const counts = [0, 0, 0, 0, 0];
      for (let i = 0; i < 10000; i++) counts[drawTier(best, rng)]!++;
      weights.forEach((w, tier) => expect(Math.abs(counts[tier]! / 10000 - w)).toBeLessThan(0.02));
      expect(counts.slice(weights.length).every((c) => c === 0)).toBe(true);
    }
  });
});

describe('予測', () => {
  it('盤面を変えず、何もない盤面では実際に着く場所と一致する', () => {
    const sim = createSimulation(1, { bodies: [], queue: [1, 0, 0] });
    const v = aimVelocity(0.8, -70, -20);
    const cmd = { originAngleRadians: 0.8, vx: v.vx, vy: v.vy };
    const before = JSON.stringify(sim.getSnapshot());
    const p = sim.predict(cmd);
    expect(JSON.stringify(sim.getSnapshot())).toBe(before);
    expect(p.valid).toBe(true);
    expect(p.end).toBe('core');

    sim.submitLaunch(cmd);
    const land = run(sim, 3 * TICK_HZ).find((e) => e.kind === 'land')!;
    const last = p.points[p.points.length - 1]!;
    expect(Math.hypot(land.x! - last.x, land.y! - last.y)).toBeLessThan(8);
  });

  it('最初に当たる天体と、合体するかどうかを返す', () => {
    const sim = createSimulation(3, { bodies: [at(0, CORE_RADIUS + 14, UP), at(3, CORE_RADIUS + 32, 0)], queue: [0, 0, 0] });
    const same = sim.predict(drop(UP));
    expect(same.end).toBe('body');
    expect(same.willMerge).toBe(true);
    const other = sim.predict(drop(0));
    expect(other.end).toBe('body');
    expect(other.willMerge).toBe(false);
    expect(sim.predict(drop(Math.PI)).end).toBe('core');
  });
});
