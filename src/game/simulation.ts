// ゲームの計算の本体。画面・音・保存・現在時刻・Math.random() を使わない。
// 同じシードと同じ射出の記録なら、必ず同じ結果になる。
//
// 動きの計算は「位置を先に進め、重なりを押し戻し、その結果から速度を求め直す」方式。
// 積み重なった円が震えずに止まりやすい。

import type {
  BodyId,
  GameEvent,
  GameSnapshot,
  LaunchCommand,
  LaunchInput,
  LaunchResult,
  Prediction,
  SimulationPort,
  Tier,
} from '../contracts/game';
import {
  CHAIN_MULT_MAX,
  CHAIN_STEP,
  CHAIN_WINDOW_SECONDS,
  CONTACT_DAMPING,
  CONTACT_SLOP,
  CORE_RADIUS,
  DT,
  GROW_SECONDS,
  HEAT_COOL_PER_SECOND,
  HEAT_MAX,
  HEAT_RISE_PER_SECOND,
  HEAT_START,
  HEAT_SUPERNOVA,
  LAUNCH_COOLDOWN,
  LAUNCH_RADIUS,
  LIMIT_GRACE_SECONDS,
  LIMIT_RADIUS,
  SLEEP_SPEED,
  SOLVER_ITERATIONS,
  START_BODY,
  TICK_HZ,
  TIER_BASE_SCORE,
  TIER_RADIUS,
} from './constants';
import { applyGravity } from './physics';
import { launchRejectReason, predictLaunch } from './predictor';
import { createRng } from './rng';
import { drawTier } from './spawner';

type Body = {
  id: BodyId;
  tier: Tier;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** この tick で進めようとしている位置 */
  px: number;
  py: number;
  radius: number;
  growFrom: number;
  growLeft: number;
  bornTick: number;
  chain: number;
  chainUntilTick: number;
  touching: boolean;
  /** 撃たれてから何かに触れたか（land イベントを 1 回だけ出すため） */
  landed: boolean;
  overLimit: boolean;
  dead: boolean;
};

/** テストと開発用。通常のプレイでは渡さない。 */
export type SimulationSetup = {
  bodies?: readonly { tier: Tier; x: number; y: number; vx?: number; vy?: number }[];
  heat?: number;
  queue?: readonly [Tier, Tier, Tier];
  bestTier?: Tier;
};

const CHAIN_WINDOW_TICKS = Math.round(CHAIN_WINDOW_SECONDS * TICK_HZ);
const LIMIT_GRACE_TICKS = Math.round(LIMIT_GRACE_SECONDS * TICK_HZ);
const MAX_SPEED = 1600;

/** 連鎖数から得点の倍率を求める。 */
export function chainMultiplier(chain: number): number {
  return Math.min(CHAIN_MULT_MAX, 1 + CHAIN_STEP * (chain - 1));
}

export function createSimulation(seed: number, setup?: SimulationSetup): SimulationPort {
  const rng = createRng(seed);
  let tick = 0;
  let nextId = 1;
  let sequence = 0;
  let heat = setup?.heat ?? HEAT_START;
  let score = 0;
  let bestTier: Tier = setup?.bestTier ?? 0;
  let over = false;
  let overLimit = false;
  let cooldown = 0;
  let pendingEvents: GameEvent[] = [];
  let snapshotCache: GameSnapshot | null = null;
  const bodies: Body[] = [];
  const queue: [Tier, Tier, Tier] = setup?.queue ? [...setup.queue] : [0, 0, drawTier(0, rng)];
  const inputLog: LaunchInput[] = [];
  const stats = { launches: 0, merges: 0, supernovas: 0, maxChain: 0 };

  function addBody(tier: Tier, x: number, y: number, vx: number, vy: number, landed: boolean): Body {
    const body: Body = {
      id: nextId++,
      tier,
      x,
      y,
      vx,
      vy,
      px: x,
      py: y,
      radius: TIER_RADIUS[tier],
      growFrom: TIER_RADIUS[tier],
      growLeft: 0,
      bornTick: tick,
      chain: 0,
      chainUntilTick: 0,
      touching: false,
      landed,
      overLimit: false,
      dead: false,
    };
    bodies.push(body);
    return body;
  }

  function emit(event: Omit<GameEvent, 'sequence' | 'tick'>): void {
    pendingEvents.push({ sequence: sequence++, tick, ...event });
  }

  if (setup?.bodies) {
    for (const b of setup.bodies) addBody(b.tier, b.x, b.y, b.vx ?? 0, b.vy ?? 0, true);
  } else {
    const r = CORE_RADIUS + TIER_RADIUS[START_BODY.tier];
    addBody(START_BODY.tier, r * Math.cos(START_BODY.angle), r * Math.sin(START_BODY.angle), 0, 0, true);
  }

  function getSnapshot(): GameSnapshot {
    if (snapshotCache) return snapshotCache;
    snapshotCache = {
      tick,
      phase: over ? 'over' : 'active',
      bodies: bodies.map((b) => ({
        id: b.id,
        tier: b.tier,
        x: b.x,
        y: b.y,
        vx: b.vx,
        vy: b.vy,
        radius: b.radius,
        bornTick: b.bornTick,
        chain: b.chain,
        chainUntilTick: b.chainUntilTick,
        overLimit: b.overLimit,
      })),
      heat,
      overLimit,
      score,
      bestTierThisRun: bestTier,
      nextQueue: [queue[0], queue[1], queue[2]],
      launchCooldownLeftSeconds: Math.max(0, cooldown),
      seed,
      stats: { ...stats },
    };
    return snapshotCache;
  }

  function submitLaunch(command: LaunchCommand): LaunchResult {
    const reason = launchRejectReason(getSnapshot(), command);
    if (reason !== null) return { accepted: false, reason };

    const tier = queue[0];
    queue[0] = queue[1];
    queue[1] = queue[2];
    queue[2] = drawTier(bestTier, rng);

    const body = addBody(
      tier,
      LAUNCH_RADIUS * Math.cos(command.originAngleRadians),
      LAUNCH_RADIUS * Math.sin(command.originAngleRadians),
      command.vx,
      command.vy,
      false,
    );
    cooldown = LAUNCH_COOLDOWN;
    stats.launches++;
    inputLog.push({ tick, originAngleRadians: command.originAngleRadians, vx: command.vx, vy: command.vy });
    emit({ kind: 'launch', x: body.x, y: body.y, bodyIds: [body.id], sourceTier: tier });
    snapshotCache = null;
    return { accepted: true, bodyId: body.id };
  }

  function merge(a: Body, b: Body, born: Body[]): void {
    a.dead = true;
    b.dead = true;
    const ma = a.radius * a.radius;
    const mb = b.radius * b.radius;
    const total = ma + mb;
    const x = (a.px * ma + b.px * mb) / total;
    const y = (a.py * ma + b.py * mb) / total;

    const chainA = tick <= a.chainUntilTick ? a.chain : 0;
    const chainB = tick <= b.chainUntilTick ? b.chain : 0;
    const chain = Math.max(chainA, chainB) + 1;
    stats.maxChain = Math.max(stats.maxChain, chain);
    const gained = Math.round(TIER_BASE_SCORE[a.tier] * chainMultiplier(chain));
    score += gained;

    if (a.tier === 8) {
      stats.supernovas++;
      heat = Math.max(0, heat - HEAT_SUPERNOVA);
      emit({ kind: 'supernova', x, y, bodyIds: [a.id, b.id], sourceTier: 8, scoreDelta: gained, heatDelta: -HEAT_SUPERNOVA, chain });
      return;
    }

    stats.merges++;
    const tier = (a.tier + 1) as Tier;
    if (tier > bestTier) bestTier = tier;
    const from = Math.max(a.radius, b.radius);
    const child: Body = {
      id: nextId++,
      tier,
      x,
      y,
      vx: (a.vx * ma + b.vx * mb) / total,
      vy: (a.vy * ma + b.vy * mb) / total,
      px: x,
      py: y,
      radius: from,
      growFrom: from,
      growLeft: GROW_SECONDS,
      bornTick: tick,
      chain,
      chainUntilTick: tick + CHAIN_WINDOW_TICKS,
      touching: false,
      landed: true,
      overLimit: false,
      dead: false,
    };
    born.push(child);
    emit({ kind: 'merge', x, y, bodyIds: [a.id, b.id, child.id], sourceTier: a.tier, resultTier: tier, scoreDelta: gained, chain });
  }

  function stepFixed(): readonly GameEvent[] {
    if (over) return [];
    snapshotCache = null;

    // 1. 時間を進める
    tick++;
    if (cooldown > 0) cooldown -= DT;

    // 2. 生まれたばかりの天体を育て、全天体の「進めたい位置」を出す
    for (const b of bodies) {
      if (b.growLeft > 0) {
        b.growLeft = Math.max(0, b.growLeft - DT);
        const target = TIER_RADIUS[b.tier];
        b.radius = target - (target - b.growFrom) * (b.growLeft / GROW_SECONDS);
      }
      applyGravity(b);
      b.px = b.x + b.vx * DT;
      b.py = b.y + b.vy * DT;
      b.touching = false;
    }

    // 3. 合体（ID の小さい順。1 体が 1 tick に参加できる合体は 1 回まで）
    const born: Body[] = [];
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i]!;
      if (a.dead) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j]!;
        if (b.dead || b.tier !== a.tier) continue;
        const reach = a.radius + b.radius + CONTACT_SLOP;
        const dx = b.px - a.px;
        const dy = b.py - a.py;
        if (dx * dx + dy * dy > reach * reach) continue;
        merge(a, b, born);
        break;
      }
    }
    let write = 0;
    for (const b of bodies) if (!b.dead) bodies[write++] = b;
    bodies.length = write;
    for (const b of born) bodies.push(b);

    // 4. 重なりを押し戻す（重い天体ほど動かない）
    for (let it = 0; it < SOLVER_ITERATIONS; it++) {
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i]!;
        for (let j = i + 1; j < bodies.length; j++) {
          const b = bodies[j]!;
          const dx = b.px - a.px;
          const dy = b.py - a.py;
          const reach = a.radius + b.radius;
          const d2 = dx * dx + dy * dy;
          if (d2 >= (reach + CONTACT_SLOP) * (reach + CONTACT_SLOP)) continue;
          a.touching = true;
          b.touching = true;
          if (d2 >= reach * reach) continue;
          const d = Math.sqrt(d2) || 1e-6;
          const overlap = reach - d;
          const wa = 1 / (a.radius * a.radius);
          const wb = 1 / (b.radius * b.radius);
          const nx = dx / d;
          const ny = dy / d;
          a.px -= (nx * overlap * wa) / (wa + wb);
          a.py -= (ny * overlap * wa) / (wa + wb);
          b.px += (nx * overlap * wb) / (wa + wb);
          b.py += (ny * overlap * wb) / (wa + wb);
        }
      }
      for (const b of bodies) {
        const r = Math.hypot(b.px, b.py);
        const min = CORE_RADIUS + b.radius;
        if (r < min + CONTACT_SLOP) b.touching = true;
        if (r < min) {
          const k = r > 1e-6 ? min / r : 0;
          if (k === 0) b.py = -min;
          else {
            b.px *= k;
            b.py *= k;
          }
        }
      }
    }

    // 5. 動いた結果から速度を求め直す
    for (const b of bodies) {
      const before = Math.hypot(b.vx, b.vy);
      b.vx = (b.px - b.x) / DT;
      b.vy = (b.py - b.y) / DT;
      b.x = b.px;
      b.y = b.py;
      if (b.touching) {
        if (!b.landed) {
          b.landed = true;
          emit({ kind: 'land', x: b.x, y: b.y, bodyIds: [b.id], sourceTier: b.tier, impactSpeed: before });
        }
        const keep = 1 - CONTACT_DAMPING * DT;
        b.vx *= keep;
        b.vy *= keep;
        if (Math.hypot(b.vx, b.vy) < SLEEP_SPEED) {
          b.vx = 0;
          b.vy = 0;
        }
      }
      const speed = Math.hypot(b.vx, b.vy);
      if (speed > MAX_SPEED) {
        b.vx *= MAX_SPEED / speed;
        b.vy *= MAX_SPEED / speed;
      }
    }

    // 6. 限界リングと熱量
    let anyOver = false;
    for (const b of bodies) {
      b.overLimit = tick - b.bornTick >= LIMIT_GRACE_TICKS && Math.hypot(b.x, b.y) + b.radius > LIMIT_RADIUS;
      if (b.overLimit) anyOver = true;
    }
    if (anyOver !== overLimit) {
      overLimit = anyOver;
      emit({ kind: anyOver ? 'overLimitStart' : 'overLimitEnd' });
    }
    const rate = anyOver ? HEAT_RISE_PER_SECOND : -HEAT_COOL_PER_SECOND;
    heat = Math.min(HEAT_MAX, Math.max(0, heat + rate * DT));

    // 7. 終了判定
    if (heat >= HEAT_MAX) {
      over = true;
      emit({ kind: 'gameOver' });
    }

    const events = pendingEvents;
    pendingEvents = [];
    return events;
  }

  function predict(command: LaunchCommand): Prediction {
    return predictLaunch(getSnapshot(), command);
  }

  return { getSnapshot, submitLaunch, stepFixed, predict, getInputLog: () => inputLog };
}
