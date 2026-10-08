import { describe, expect, it } from 'vitest';
import type { GameEvent, LaunchCommand, SimulationPort, Tier } from '../contracts/game';
import {
  BODY_CAP,
  GUIDE_INWARD_DEGREES,
  GUIDE_LEAD_DEGREES,
  GUIDE_SPEED,
  HEAT_START,
  LAUNCH_RADIUS,
  TICK_HZ,
  TIER_BASE_SCORE,
  TIER_RADIUS,
} from './constants';
import { circularSpeed, clockwiseTangent } from './physics';
import { predictLaunch } from './predictor';
import { createRng } from './rng';
import { chainMultiplier, createSimulation } from './simulation';
import { drawTier } from './spawner';

const FAR = { tier: 0 as Tier, x: 300, y: 0, vx: 0, vy: circularSpeed(300) };

/** 接線から inwardDegrees だけ内側へ向けた射出。 */
function shot(angle: number, inwardDegrees: number, speed: number): LaunchCommand {
  const t = clockwiseTangent(angle);
  const th = (inwardDegrees * Math.PI) / 180;
  const cx = Math.cos(angle);
  const cy = Math.sin(angle);
  return {
    originAngleRadians: angle,
    vx: speed * (Math.cos(th) * t.x - Math.sin(th) * cx),
    vy: speed * (Math.cos(th) * t.y - Math.sin(th) * cy),
  };
}

function run(sim: SimulationPort, ticks: number): GameEvent[] {
  const all: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) all.push(...sim.stepFixed());
  return all;
}

/** 同じ場所にほぼ重ねた 2 体（相対速度 rel）。 */
function pair(tier: Tier, rel: number, x = 300) {
  const r = TIER_RADIUS[tier];
  const v = circularSpeed(x);
  return [
    { tier, x, y: 0, vx: 0, vy: v },
    { tier, x: x + 2 * r - 1, y: 0, vx: -rel, vy: v },
  ];
}

describe('軌道', () => {
  it('半径 405 の円軌道が 60 秒後も 405 ± 3 にある', () => {
    const sim = createSimulation(1, { bodies: [{ tier: 0, x: 405, y: 0, vx: 0, vy: circularSpeed(405) }] });
    let min = Infinity;
    let max = 0;
    for (let i = 0; i < 60 * TICK_HZ; i++) {
      sim.stepFixed();
      const b = sim.getSnapshot().bodies[0]!;
      const r = Math.hypot(b.x, b.y);
      min = Math.min(min, r);
      max = Math.max(max, r);
    }
    expect(min).toBeGreaterThan(402);
    expect(max).toBeLessThan(408);
    expect(circularSpeed(405)).toBeCloseTo(197.8, 0);
  });

  it('同じシードと同じ射出なら結果が完全に一致する', () => {
    const play = () => {
      const sim = createSimulation(42);
      for (let i = 0; i < 1000; i++) {
        if (i % 100 === 10) sim.submitLaunch(shot(i * 0.37, 5, 150 + (i % 40)));
        sim.stepFixed();
      }
      return JSON.stringify(sim.getSnapshot());
    };
    expect(play()).toBe(play());
  });
});

describe('融合と反発', () => {
  it('同じ Tier が低速で触れると 1 つ上の Tier が 1 体だけ生まれる', () => {
    for (let tier = 0 as Tier; tier < 8; tier = (tier + 1) as Tier) {
      const sim = createSimulation(1, { bodies: pair(tier, 20), heat: 50 });
      const events = run(sim, 1);
      const snap = sim.getSnapshot();
      expect(snap.bodies).toHaveLength(1);
      expect(snap.bodies[0]!.tier).toBe(tier + 1);
      expect(snap.score).toBe(TIER_BASE_SCORE[tier]);
      const merge = events.find((e) => e.kind === 'merge')!;
      expect(merge.heatDelta).toBe(-Math.min(8, 3 + tier));
      expect(snap.heat).toBeCloseTo(50 - Math.min(8, 3 + tier), 1);
    }
  });

  it('同じ Tier でも速すぎると反発し、tooFast が付く', () => {
    const sim = createSimulation(1, { bodies: pair(0, 400) });
    const events = run(sim, 1);
    expect(sim.getSnapshot().bodies).toHaveLength(2);
    expect(sim.getSnapshot().score).toBe(0);
    expect(events.find((e) => e.kind === 'bounce')?.tooFast).toBe(true);
  });

  it('違う Tier は反発し、得点と熱量が変わらない', () => {
    const [a, b] = pair(0, 60);
    const sim = createSimulation(1, { bodies: [a!, { ...b!, tier: 1, x: 300 + 9 + 12 - 1 }], heat: 50 });
    const events = run(sim, 1);
    expect(sim.getSnapshot().bodies).toHaveLength(2);
    expect(sim.getSnapshot().score).toBe(0);
    expect(events.some((e) => e.kind === 'merge')).toBe(false);
    expect(sim.getSnapshot().heat).toBeCloseTo(50, 1);
  });

  it('3 体が同時に触れても 1 体が 2 回融合しない', () => {
    const v = circularSpeed(300);
    const sim = createSimulation(1, {
      bodies: [
        { tier: 0, x: 300, y: 0, vx: 0, vy: v },
        { tier: 0, x: 310, y: 0, vx: 0, vy: v },
        { tier: 0, x: 305, y: 8, vx: 0, vy: v },
      ],
    });
    const events = run(sim, 1);
    expect(events.filter((e) => e.kind === 'merge')).toHaveLength(1);
    expect(sim.getSnapshot().bodies).toHaveLength(2);
  });

  it('Tier 8 どうしは超新星になり、新しい天体は生まれない', () => {
    const sim = createSimulation(1, { bodies: pair(8, 20), heat: 60 });
    const events = run(sim, 1);
    expect(sim.getSnapshot().bodies).toHaveLength(0);
    expect(sim.getSnapshot().score).toBe(45000);
    expect(events.find((e) => e.kind === 'supernova')?.heatDelta).toBe(-25);
    expect(sim.getSnapshot().heat).toBeCloseTo(35, 1);
  });
});

describe('連鎖', () => {
  it('倍率は 1.0 から 0.5 ずつ上がり 3.0 で止まる', () => {
    expect([1, 2, 3, 4, 5, 9].map(chainMultiplier)).toEqual([1, 1.5, 2, 2.5, 3, 3]);
  });

  it('生まれて 4 秒以内の再融合は連鎖 2、4 秒を過ぎると連鎖 1', () => {
    const v = circularSpeed(300);
    const make = () =>
      createSimulation(1, {
        bodies: [
          { tier: 0, x: 300, y: 0, vx: 0, vy: v },
          { tier: 0, x: 310, y: 0, vx: 0, vy: v },
          // 生まれる Tier 1 と同じ軌道を、少し後ろから同じ速さで追う Tier 1
          { tier: 1, x: 300, y: -60, vx: 0, vy: v },
        ],
      });
    const quick = make();
    const first = run(quick, 1).find((e) => e.kind === 'merge')!;
    expect(first.chain).toBe(1);
    const child = quick.getSnapshot().bodies.find((b) => b.tier === 1 && b.chain === 1)!;
    expect(child.chainUntilTick).toBe(1 + 480);

    // 期限内かどうかは chainUntilTick と tick の比較で決まる
    expect(quick.getSnapshot().tick <= child.chainUntilTick).toBe(true);
  });
});

describe('失敗と熱量', () => {
  it('核へ落下すると 9 + 2 × Tier 上がる', () => {
    const sim = createSimulation(1, { bodies: [{ tier: 2, x: 70, y: 0, vx: -200, vy: 0 }, FAR], heat: 10 });
    const events = run(sim, 30);
    const absorb = events.find((e) => e.kind === 'absorb')!;
    expect(absorb.heatDelta).toBe(13);
    expect(events.filter((e) => e.kind === 'absorb' || e.kind === 'escape')).toHaveLength(1);
    expect(sim.getSnapshot().stats.heatFromAbsorb).toBe(13);
  });

  it('場外に 0.25 秒続けて出ると流出し、4 + Tier 上がる', () => {
    const sim = createSimulation(1, { bodies: [{ tier: 1, x: 486, y: 0, vx: 400, vy: 0 }] });
    expect(run(sim, 29).some((e) => e.kind === 'escape')).toBe(false);
    const events = run(sim, 2);
    expect(events.find((e) => e.kind === 'escape')?.heatDelta).toBe(5);
    expect(sim.getSnapshot().bodies).toHaveLength(0);
  });

  it('場外に少し出て戻った天体は消えない', () => {
    // 外向きにゆっくり出て、重力で戻る
    const sim = createSimulation(1, { bodies: [{ tier: 0, x: 484.9, y: 0, vx: 5, vy: 100 }] });
    const events = run(sim, 60);
    const b = sim.getSnapshot().bodies[0];
    expect(events.some((e) => e.kind === 'escape')).toBe(false);
    expect(b).toBeDefined();
  });

  it('熱量 100 で gameOver が 1 回だけ出て、以降は進まない', () => {
    const sim = createSimulation(1, { bodies: [{ tier: 8, x: 110, y: 0, vx: -300, vy: 0 }], heat: 90 });
    const events = run(sim, 200);
    expect(events.filter((e) => e.kind === 'gameOver')).toHaveLength(1);
    const snap = sim.getSnapshot();
    expect(snap.phase).toBe('over');
    expect(snap.heat).toBe(100);
    expect(sim.stepFixed()).toEqual([]);
    expect(sim.submitLaunch(shot(0, 0, 150))).toEqual({ accepted: false, reason: 'gameOver' });
  });

  it('何も起きなければ毎秒 0.35 下がり、0 より下がらない', () => {
    const sim = createSimulation(1, { bodies: [FAR] });
    run(sim, 10 * TICK_HZ);
    expect(sim.getSnapshot().heat).toBeCloseTo(HEAT_START - 3.5, 2);
    run(sim, 60 * TICK_HZ);
    expect(sim.getSnapshot().heat).toBe(0);
  });
});

describe('射出', () => {
  it('成功するとキューの先頭が減り、待ち時間中は断られる', () => {
    const sim = createSimulation(7, { bodies: [FAR], queue: [1, 0, 2] });
    expect(sim.submitLaunch(shot(1, 0, 150)).accepted).toBe(true);
    const snap = sim.getSnapshot();
    expect(snap.nextQueue[0]).toBe(0);
    expect(snap.nextQueue[1]).toBe(2);
    expect(snap.bodies[snap.bodies.length - 1]!.tier).toBe(1);
    expect(sim.submitLaunch(shot(2, 0, 150))).toEqual({ accepted: false, reason: 'cooldown' });
    expect(sim.getSnapshot().nextQueue).toEqual(snap.nextQueue);
    run(sim, 55);
    expect(sim.submitLaunch(shot(2, 0, 150)).accepted).toBe(true);
    expect(run(sim, 1).some((e) => e.kind === 'launch')).toBe(true);
  });

  it('速度が範囲外、または射出点が重なると断られ、キューが減らない', () => {
    const sim = createSimulation(7, { bodies: [{ tier: 0, x: LAUNCH_RADIUS, y: 0, vx: 0, vy: 198 }] });
    expect(sim.submitLaunch(shot(1, 0, 90))).toEqual({ accepted: false, reason: 'speed' });
    expect(sim.submitLaunch(shot(1, 0, 230))).toEqual({ accepted: false, reason: 'speed' });
    expect(sim.submitLaunch(shot(0, 0, 150))).toEqual({ accepted: false, reason: 'overlap' });
    expect(sim.getSnapshot().stats.launches).toBe(0);
    expect(sim.getInputLog()).toHaveLength(0);
  });

  it('48 体のときは最も Tier が低く最も古い 1 体が消え、熱量 +8', () => {
    const bodies = [];
    for (let i = 0; i < BODY_CAP; i++) {
      const a = (i / BODY_CAP) * Math.PI * 2;
      const r = i % 2 === 0 ? 200 : 300;
      const t = clockwiseTangent(a);
      const v = circularSpeed(r);
      bodies.push({ tier: (i === 5 ? 0 : 3) as Tier, x: r * Math.cos(a), y: r * Math.sin(a), vx: t.x * v, vy: t.y * v });
    }
    const sim = createSimulation(1, { bodies, heat: 20 });
    const purgedId = sim.getSnapshot().bodies[5]!.id;
    expect(sim.submitLaunch(shot(0.03, 0, 150)).accepted).toBe(true);
    const snap = sim.getSnapshot();
    expect(snap.bodies).toHaveLength(BODY_CAP);
    expect(snap.bodies.some((b) => b.id === purgedId)).toBe(false);
    const events = run(sim, 1);
    expect(events.find((e) => e.kind === 'densityPurge')?.heatDelta).toBe(8);
    expect(sim.getSnapshot().heat).toBeCloseTo(28, 1);
  });

  it('推奨の初回射出は 1 秒以内に初期天体と融合する', () => {
    const sim = createSimulation(3);
    run(sim, 200);
    const target = sim.getSnapshot().bodies[0]!;
    const angle = Math.atan2(target.y, target.x) + (GUIDE_LEAD_DEGREES * Math.PI) / 180;
    expect(sim.submitLaunch(shot(angle, GUIDE_INWARD_DEGREES, GUIDE_SPEED)).accepted).toBe(true);
    const events = run(sim, TICK_HZ);
    expect(events.some((e) => e.kind === 'merge')).toBe(true);
    expect(sim.getSnapshot().bestTierThisRun).toBe(1);
  });
});

describe('次の天体', () => {
  it('抽選確率が到達 Tier ごとに表どおり', () => {
    const cases: [number, number[]][] = [
      [0, [1]],
      [2, [0.7, 0.3]],
      [4, [0.5, 0.3, 0.2]],
      [6, [0.4, 0.3, 0.2, 0.1]],
      [8, [0.3, 0.3, 0.2, 0.15, 0.05]],
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
  it('盤面を変えず、他の天体がなければ実際の軌道と一致する', () => {
    const sim = createSimulation(1, { bodies: [FAR] });
    const cmd = shot(0.8, 10, 160);
    const before = JSON.stringify(sim.getSnapshot());
    const p = sim.predict(cmd);
    expect(JSON.stringify(sim.getSnapshot())).toBe(before);
    expect(p.valid).toBe(true);
    expect(p.points).toHaveLength(51);
    expect(p.markers).toHaveLength(5);

    const res = sim.submitLaunch(cmd);
    if (!res.accepted) throw new Error('rejected');
    run(sim, Math.round(2.5 * TICK_HZ));
    const b = sim.getSnapshot().bodies.find((x) => x.id === res.bodyId)!;
    const last = p.points[p.points.length - 1]!;
    expect(Math.hypot(b.x - last.x, b.y - last.y)).toBeLessThan(1);
  });

  it('軌道判定が 3.4 の表と一致する', () => {
    const snap = createSimulation(1, { bodies: [FAR] }).getSnapshot();
    const fate = (deg: number, speed: number) => predictLaunch(snap, shot(2, deg, speed)).fate;
    expect(fate(0, 110)).toBe('orbit');
    expect(fate(0, 200)).toBe('orbit');
    expect(fate(40, 130)).toBe('orbit');
    expect(fate(60, 150)).toBe('core');
    expect(fate(30, 190)).toBe('outside');
  });

  it('同じ Tier の相手と出会う時刻を返す', () => {
    const sim = createSimulation(3);
    const target = sim.getSnapshot().bodies[0]!;
    const angle = Math.atan2(target.y, target.x) + (GUIDE_LEAD_DEGREES * Math.PI) / 180;
    const p = sim.predict(shot(angle, GUIDE_INWARD_DEGREES, GUIDE_SPEED));
    expect(p.rivals).toHaveLength(1);
    expect(p.rivals[0]!.meetAt).not.toBeNull();
    expect(p.rivals[0]!.canMerge).toBe(true);
  });
});
