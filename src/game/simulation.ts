// ゲームの計算の本体（SPEC.md 2〜5 章）。画面・音・保存・現在時刻・Math.random() を使わない。
// 同じシードと同じ射出の記録なら、必ず同じ結果になる。

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
import { resolveBounce } from './collision';
import {
  BODY_CAP,
  BOUNCE_EVENT_MIN_SPEED,
  CHAIN_MULT_MAX,
  CHAIN_STEP,
  CHAIN_WINDOW_SECONDS,
  CORE_RADIUS,
  DT,
  HEAT_ABSORB_BASE,
  HEAT_ABSORB_PER_TIER,
  HEAT_COOL_PER_SECOND,
  HEAT_ESCAPE_BASE,
  HEAT_ESCAPE_PER_TIER,
  HEAT_MAX,
  HEAT_MERGE_BASE,
  HEAT_MERGE_CAP,
  HEAT_PURGE,
  HEAT_START,
  HEAT_SUPERNOVA,
  LAUNCH_COOLDOWN,
  LAUNCH_RADIUS,
  MERGE_GRACE,
  OUT_RADIUS,
  OUT_SECONDS,
  START_BODY,
  TICK_HZ,
  TIER_BASE_SCORE,
  TIER_RADIUS,
} from './constants';
import { circularSpeed, clockwiseTangent, mergeSpeedLimit, stepGravity } from './physics';
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
  radius: number;
  bornTick: number;
  chain: number;
  chainUntilTick: number;
  grace: number;
  outSeconds: number;
  dead: boolean;
};

/** テストと開発用。通常のプレイでは渡さない。 */
export type SimulationSetup = {
  bodies?: readonly { tier: Tier; x: number; y: number; vx: number; vy: number }[];
  heat?: number;
  queue?: readonly [Tier, Tier, Tier];
  bestTier?: Tier;
};

const CHAIN_WINDOW_TICKS = Math.round(CHAIN_WINDOW_SECONDS * TICK_HZ);

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
  let cooldown = 0;
  let pendingHeat = 0;
  let pendingEvents: GameEvent[] = [];
  let snapshotCache: GameSnapshot | null = null;
  const bodies: Body[] = [];
  const queue: [Tier, Tier, Tier] = setup?.queue ? [...setup.queue] : [0, 0, 0];
  const inputLog: LaunchInput[] = [];
  const stats = {
    launches: 0,
    merges: 0,
    supernovas: 0,
    maxChain: 0,
    heatFromAbsorb: 0,
    heatFromEscape: 0,
    heatFromPurge: 0,
  };

  function addBody(tier: Tier, x: number, y: number, vx: number, vy: number): Body {
    const body: Body = {
      id: nextId++,
      tier,
      x,
      y,
      vx,
      vy,
      radius: TIER_RADIUS[tier],
      bornTick: tick,
      chain: 0,
      chainUntilTick: 0,
      grace: 0,
      outSeconds: 0,
      dead: false,
    };
    bodies.push(body);
    return body;
  }

  function emit(event: Omit<GameEvent, 'sequence' | 'tick'>): void {
    pendingEvents.push({ sequence: sequence++, tick, ...event });
  }

  if (setup?.bodies) {
    for (const b of setup.bodies) addBody(b.tier, b.x, b.y, b.vx, b.vy);
  } else {
    const t = clockwiseTangent(START_BODY.angle);
    const v = circularSpeed(START_BODY.radius);
    addBody(
      START_BODY.tier,
      START_BODY.radius * Math.cos(START_BODY.angle),
      START_BODY.radius * Math.sin(START_BODY.angle),
      t.x * v,
      t.y * v,
    );
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
      })),
      heat,
      score,
      bestTierThisRun: bestTier,
      nextQueue: [queue[0], queue[1], queue[2]],
      launchCooldownLeftSeconds: Math.max(0, cooldown),
      seed,
      stats: { ...stats },
    };
    return snapshotCache;
  }

  /** 過密のとき、最も Tier が低く最も古い 1 体を消す。 */
  function purgeOne(): void {
    let target = bodies[0]!;
    for (const b of bodies) {
      if (
        b.tier < target.tier ||
        (b.tier === target.tier && (b.bornTick < target.bornTick || (b.bornTick === target.bornTick && b.id < target.id)))
      ) {
        target = b;
      }
    }
    bodies.splice(bodies.indexOf(target), 1);
    pendingHeat += HEAT_PURGE;
    stats.heatFromPurge += HEAT_PURGE;
    emit({ kind: 'densityPurge', x: target.x, y: target.y, bodyIds: [target.id], sourceTier: target.tier, heatDelta: HEAT_PURGE });
  }

  function submitLaunch(command: LaunchCommand): LaunchResult {
    const reason = launchRejectReason(getSnapshot(), command);
    if (reason !== null) return { accepted: false, reason };

    if (bodies.length >= BODY_CAP) purgeOne();
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
    const x = (a.x * ma + b.x * mb) / total;
    const y = (a.y * ma + b.y * mb) / total;

    const chainA = tick <= a.chainUntilTick ? a.chain : 0;
    const chainB = tick <= b.chainUntilTick ? b.chain : 0;
    const chain = Math.max(chainA, chainB) + 1;
    stats.maxChain = Math.max(stats.maxChain, chain);
    const gained = Math.round(TIER_BASE_SCORE[a.tier] * chainMultiplier(chain));
    score += gained;

    if (a.tier === 8) {
      stats.supernovas++;
      pendingHeat -= HEAT_SUPERNOVA;
      emit({ kind: 'supernova', x, y, bodyIds: [a.id, b.id], sourceTier: 8, scoreDelta: gained, heatDelta: -HEAT_SUPERNOVA, chain });
      return;
    }

    const cooling = Math.min(HEAT_MERGE_CAP, HEAT_MERGE_BASE + a.tier);
    pendingHeat -= cooling;
    stats.merges++;
    const tier = (a.tier + 1) as Tier;
    if (tier > bestTier) bestTier = tier;
    const child: Body = {
      id: nextId++,
      tier,
      x,
      y,
      vx: (a.vx * ma + b.vx * mb) / total,
      vy: (a.vy * ma + b.vy * mb) / total,
      radius: TIER_RADIUS[tier],
      bornTick: tick,
      chain,
      chainUntilTick: tick + CHAIN_WINDOW_TICKS,
      grace: MERGE_GRACE,
      outSeconds: 0,
      dead: false,
    };
    born.push(child);
    emit({
      kind: 'merge',
      x,
      y,
      bodyIds: [a.id, b.id, child.id],
      sourceTier: a.tier,
      resultTier: tier,
      scoreDelta: gained,
      heatDelta: -cooling,
      chain,
    });
  }

  function stepFixed(): readonly GameEvent[] {
    if (over) return [];
    snapshotCache = null;

    // 1. 時間を進める
    tick++;
    if (cooldown > 0) cooldown -= DT;
    for (const b of bodies) if (b.grace > 0) b.grace -= DT;

    // 2. 重力と移動
    for (const b of bodies) stepGravity(b);

    // 3. 接触（ID の小さい順）
    const born: Body[] = [];
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i]!;
      if (a.dead || a.grace > 0) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j]!;
        if (b.dead || b.grace > 0) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const reach = a.radius + b.radius;
        if (dx * dx + dy * dy >= reach * reach) continue;

        const sameTier = a.tier === b.tier;
        const relSpeed = Math.hypot(b.vx - a.vx, b.vy - a.vy);
        if (sameTier && relSpeed <= mergeSpeedLimit(a.tier)) {
          merge(a, b, born);
          break; // a はこの tick ではもう接触しない
        }
        const closing = resolveBounce(a, b);
        if (closing > BOUNCE_EVENT_MIN_SPEED) {
          emit({
            kind: 'bounce',
            x: (a.x * b.radius + b.x * a.radius) / reach,
            y: (a.y * b.radius + b.y * a.radius) / reach,
            bodyIds: [a.id, b.id],
            sourceTier: a.tier,
            ...(sameTier ? { tooFast: true } : {}),
          });
        }
      }
    }

    // 4. 核への落下  5. 流出
    for (const b of bodies) {
      if (b.dead) continue;
      const r = Math.hypot(b.x, b.y);
      if (r <= CORE_RADIUS + b.radius) {
        b.dead = true;
        const delta = HEAT_ABSORB_BASE + HEAT_ABSORB_PER_TIER * b.tier;
        pendingHeat += delta;
        stats.heatFromAbsorb += delta;
        emit({ kind: 'absorb', x: b.x, y: b.y, bodyIds: [b.id], sourceTier: b.tier, heatDelta: delta });
      } else if (r > OUT_RADIUS) {
        b.outSeconds += DT;
        if (b.outSeconds >= OUT_SECONDS - 1e-9) {
          b.dead = true;
          const delta = HEAT_ESCAPE_BASE + HEAT_ESCAPE_PER_TIER * b.tier;
          pendingHeat += delta;
          stats.heatFromEscape += delta;
          emit({ kind: 'escape', x: b.x, y: b.y, bodyIds: [b.id], sourceTier: b.tier, heatDelta: delta });
        }
      } else {
        b.outSeconds = 0;
      }
    }

    // 6. 消えた天体を除き、生まれた天体を加える
    let write = 0;
    for (const b of bodies) if (!b.dead) bodies[write++] = b;
    bodies.length = write;
    for (const b of born) bodies.push(b);

    // 7. 熱量をまとめて反映する
    heat = Math.min(HEAT_MAX, Math.max(0, heat + pendingHeat - HEAT_COOL_PER_SECOND * DT));
    pendingHeat = 0;

    // 8. 終了判定
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
