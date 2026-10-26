// ゲームの計算の本体。画面・音・保存・現在時刻・Math.random() を使わない。
// 同じシードと同じ射出の記録なら、必ず同じ結果になる。
//
// 動きの計算は「位置を先に進め、重なりを押し戻し、その結果から速度を求め直す」方式。
// 積み重なった円が震えずに止まりやすい。

import type {
  BodyId,
  ChainStage,
  GameEvent,
  GameSnapshot,
  GravityCommand,
  GravityResult,
  LaunchCommand,
  LaunchInput,
  LaunchResult,
  Prediction,
  SimulationPort,
  Tier,
} from '../contracts/game';
import {
  CHAIN_MULT_MAX,
  CHAIN_STAGE_MAX,
  CHAIN_STEP,
  CHAIN_GRACE_SECONDS,
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
  INTERVENTION_UNLOCK_TIER,
  INTERVENTION_WINDOW_SECONDS,
  LAUNCH_COOLDOWN,
  LAUNCH_RADIUS,
  LIMIT_GRACE_SECONDS,
  LIMIT_HYSTERESIS,
  LIMIT_RADIUS,
  REPEAT_LAUNCH_MEMORY,
  SLEEP_SPEED,
  START_BODY,
  TICK_HZ,
  TIER_BASE_SCORE,
  TIER_RADIUS,
} from './constants';
import { solveContacts } from './contacts';
import { driftBoard } from './board-drift';
import { createGravity, defaultGravityTuning, type GravityState, type GravityTuning } from './gravity';
import { fusionCooling } from './heat';
import { launchHeating } from './launch-heat';
import { applyGravity } from './physics';
import { launchRejectReason, predictLaunch, quantizeLaunch } from './predictor';
import { createRng, createRngFromState } from './rng';
import { createTierBag, type TierBagState } from './spawner';

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
  /** 重力弾（ゲージ成功）で撃たれ、まだ何にも触れていない */
  charged?: boolean;
};

/** テストと開発用。通常のプレイでは渡さない。 */
export type SimulationSetup = {
  bodies?: readonly { tier: Tier; x: number; y: number; vx?: number; vy?: number }[];
  heat?: number;
  queue?: readonly [Tier, Tier, Tier];
  bestTier?: Tier;
};

/**
 * 途中の盤面を丸ごと書き出した物（再生で後ろへ飛ぶ時に、途中から計算し直すため）。
 * restoreSimulation に渡すと、書き出した時と全く同じ続きになる。
 * メモリの中で持つ用。JSON にすると -0 が 0 になり、ビット一致が崩れうる。中身は見ない・書き換えない。
 */
export type SimulationState = Readonly<{
  format: 6;
  seed: number;
  rngState: number;
  tick: number;
  nextId: number;
  sequence: number;
  heat: number;
  score: number;
  bestTier: Tier;
  over: boolean;
  overLimit: boolean;
  cooldown: number;
  pendingEvents: readonly GameEvent[];
  bodies: readonly Readonly<Body>[];
  queue: readonly [Tier, Tier, Tier];
  bag: TierBagState;
  inputLog: readonly LaunchInput[];
  stats: Readonly<GameSnapshot['stats']>;
  /** 重力操作（試作）の状態。重力操作が無効の計算では null */
  gravity: GravityState | null;
  gravityPrototype: boolean;
  interventionCooling: number;
}>;

/** createSimulation が返す物。SimulationPort に、途中の盤面の書き出しを足した物。 */
export type Simulation = SimulationPort & {
  /** 今の状態を書き出す。書き出した後に本体を進めても、書き出した物は変わらない */
  exportState(): SimulationState;
};

/** イベントを中の配列ごと写す（書き出した物と動いている盤面が配列を共有しないように） */
function copyEvent(e: GameEvent): GameEvent {
  return e.bodyIds ? { ...e, bodyIds: [...e.bodyIds] } : { ...e };
}

const CHAIN_WINDOW_TICKS = Math.round(CHAIN_WINDOW_SECONDS * TICK_HZ);
const CHAIN_GRACE_TICKS = Math.round(CHAIN_GRACE_SECONDS * TICK_HZ);
const LIMIT_GRACE_TICKS = Math.round(LIMIT_GRACE_SECONDS * TICK_HZ);
const MAX_SPEED = 1600;

/** 連鎖数から得点の倍率を求める。 */
export function chainMultiplier(chain: number): number {
  return Math.min(CHAIN_MULT_MAX, 1 + CHAIN_STEP * (chain - 1));
}

/**
 * @param gravityTuning 渡したときは試作の全操作を使える。通常は崩壊だけを射出後の一手にする。
 */
export function createSimulation(seed: number, setup?: SimulationSetup, gravityTuning?: GravityTuning): Simulation {
  return build(seed, setup, null, gravityTuning);
}

/** exportState() で書き出した状態から、続きを計算できるシミュレーションを作る。 */
export function restoreSimulation(state: SimulationState): Simulation {
  if (state.format !== 6) throw new Error(`restoreSimulation: 知らない形式 ${String(state.format)}`);
  return build(state.seed, undefined, state, undefined);
}

function build(
  seed: number,
  setup: SimulationSetup | undefined,
  saved: SimulationState | null,
  gravityTuning: GravityTuning | undefined,
): Simulation {
  const rng = saved ? createRngFromState(saved.rngState) : createRng(seed);
  const bag = createTierBag(rng, saved?.bag);
  const gravityPrototype = saved?.gravityPrototype ?? gravityTuning !== undefined;
  const gravity = saved?.gravity
    ? createGravity({ ...saved.gravity.tuning }, saved.gravity)
    : createGravity(gravityTuning ?? defaultGravityTuning());
  let tick = saved?.tick ?? 0;
  let nextId = saved?.nextId ?? 1;
  let sequence = saved?.sequence ?? 0;
  let heat = saved?.heat ?? setup?.heat ?? HEAT_START;
  let score = saved?.score ?? 0;
  let bestTier: Tier = saved?.bestTier ?? setup?.bestTier ?? 0;
  let over = saved?.over ?? false;
  let overLimit = saved?.overLimit ?? false;
  let cooldown = saved?.cooldown ?? 0;
  let interventionCooling = saved?.interventionCooling ?? 0;
  let pendingEvents: GameEvent[] = saved ? saved.pendingEvents.map(copyEvent) : [];
  let snapshotCache: GameSnapshot | null = null;
  const bodies: Body[] = saved ? saved.bodies.map((b) => ({ ...b })) : [];
  const queue: [Tier, Tier, Tier] = saved
    ? [saved.queue[0], saved.queue[1], saved.queue[2]]
    : setup?.queue
      ? [...setup.queue]
      : [0, 0, bag.draw(0)];
  const inputLog: LaunchInput[] = saved ? saved.inputLog.map((i) => ({ ...i })) : [];
  const stats = saved ? { ...saved.stats } : { launches: 0, merges: 0, supernovas: 0, maxChain: 0 };

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

  if (saved) {
    // 天体は書き出した物をそのまま使う
  } else if (setup?.bodies) {
    for (const b of setup.bodies) addBody(b.tier, b.x, b.y, b.vx ?? 0, b.vy ?? 0, true);
  } else {
    const r = CORE_RADIUS + TIER_RADIUS[START_BODY.tier];
    addBody(START_BODY.tier, r * Math.cos(START_BODY.angle), r * Math.sin(START_BODY.angle), 0, 0, true);
  }

  function getSnapshot(): GameSnapshot {
    if (snapshotCache) return snapshotCache;
    const lastShot = inputLog.at(-1), g = gravity.view();
    const windowLeft = lastShot ? Math.max(0, INTERVENTION_WINDOW_SECONDS - (tick - lastShot.tick) / TICK_HZ) : 0;
    const used = lastShot?.collapseTick !== undefined;
    const unlocked = bestTier >= INTERVENTION_UNLOCK_TIER;
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
      recentLaunches: inputLog.slice(-REPEAT_LAUNCH_MEMORY).map(({ tick, originAngleRadians }) => ({ tick, originAngleRadians })),
      intervention: { unlocked, charge: g.burst.value, max: g.burst.max,
        ready: !over && unlocked && !used && windowLeft > 0 && g.burst.ready && g.collapseLeftSeconds === 0,
        windowLeftSeconds: windowLeft, activeLeftSeconds: g.collapseLeftSeconds, used, coolingThisTick: interventionCooling },
      ...(gravityPrototype ? { gravity: g } : {}),
    };
    return snapshotCache;
  }

  function submitLaunch(raw: LaunchCommand): LaunchResult {
    const command = quantizeLaunch(raw);
    const reason = launchRejectReason(getSnapshot(), command);
    if (reason !== null) return { accepted: false, reason };

    const addedHeat = Math.min(HEAT_MAX - heat, launchHeating(tick, bestTier, inputLog, command.originAngleRadians));
    heat += addedHeat;

    const tier = queue[0];
    queue[0] = queue[1];
    queue[1] = queue[2];
    queue[2] = bag.draw(bestTier);

    const body = addBody(
      tier,
      LAUNCH_RADIUS * Math.cos(command.originAngleRadians),
      LAUNCH_RADIUS * Math.sin(command.originAngleRadians),
      command.vx,
      command.vy,
      false,
    );
    // 重力弾は、重力操作が有効の計算だけで効く
    if (command.charged && gravityPrototype) body.charged = true;
    cooldown = LAUNCH_COOLDOWN;
    stats.launches++;
    inputLog.push({
      tick,
      originAngleRadians: command.originAngleRadians,
      vx: command.vx,
      vy: command.vy,
      ...(body.charged ? { charged: true } : {}),
    });
    emit({ kind: 'launch', x: body.x, y: body.y, bodyIds: [body.id], sourceTier: tier,
      ...(addedHeat > 0 ? { heatDelta: addedHeat } : {}) });
    if (heat >= HEAT_MAX) { over = true; emit({ kind: 'gameOver', x: body.x, y: body.y }); }
    snapshotCache = null;
    return { accepted: true, bodyId: body.id, ...(addedHeat > 0 ? { heatDelta: addedHeat } : {}) };
  }

  function merge(a: Body, b: Body, born: Body[]): void {
    a.dead = true;
    b.dead = true;
    const ma = a.radius * a.radius;
    const mb = b.radius * b.radius;
    const total = ma + mb;
    const x = (a.px * ma + b.px * mb) / total;
    const y = (a.py * ma + b.py * mb) / total;

    const chainA = tick <= a.chainUntilTick + CHAIN_GRACE_TICKS ? a.chain : 0;
    const chainB = tick <= b.chainUntilTick + CHAIN_GRACE_TICKS ? b.chain : 0;
    const chain = Math.max(chainA, chainB) + 1;
    const chainStage = Math.min(CHAIN_STAGE_MAX, chain) as ChainStage;
    const stageAdvanced = chain <= CHAIN_STAGE_MAX;
    gravity?.onMerge(chain);
    stats.maxChain = Math.max(stats.maxChain, chain);
    const gained = Math.round(TIER_BASE_SCORE[a.tier] * chainMultiplier(chain));
    score += gained;
    const cooling = fusionCooling(heat, chain, a.tier === 8);
    heat -= cooling;
    const heatDelta = 0 - cooling;

    if (a.tier === 8) {
      stats.supernovas++;
      emit({ kind: 'supernova', x, y, bodyIds: [a.id, b.id], sourceTier: 8, scoreDelta: gained, heatDelta, chain, chainStage, stageAdvanced });
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
    emit({ kind: 'merge', x, y, bodyIds: [a.id, b.id, child.id], sourceTier: a.tier, resultTier: tier, scoreDelta: gained, heatDelta, chain, chainStage, stageAdvanced });
  }

  function stepFixed(): readonly GameEvent[] {
    if (over) {
      // 射出の加熱で終わった時も、その射出と終了の出来事を一度だけ届ける。
      const events = pendingEvents; pendingEvents = []; return events;
    }
    snapshotCache = null;

    // 1. 時間を進める
    tick++;
    if (cooldown > 0) cooldown -= DT;
    gravity?.advance();
    // 重力操作が何も効いていない tick は、元の計算をそのまま通す
    const bent = gravity !== null && gravity.active();

    // 2. 生まれたばかりの天体を育て、全天体の「進めたい位置」を出す
    for (const b of bodies) {
      if (b.growLeft > 0) {
        b.growLeft = Math.max(0, b.growLeft - DT);
        const target = TIER_RADIUS[b.tier];
        b.radius = target - (target - b.growFrom) * (b.growLeft / GROW_SECONDS);
      }
    }
    if (gravity && bent) gravity.applyForces(bodies);
    else for (const b of bodies) applyGravity(b);
    for (const b of bodies) {
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

    // 4. 重なりを押し戻し、成長が伝えた位置補正を分ける
    const growth = solveContacts(bodies);

    // 5. 動いた結果から速度を求め直す
    const pileCap = gravity && bent ? gravity.pileSpeedCap(MAX_SPEED) : MAX_SPEED;
    for (const b of bodies) {
      const before = Math.hypot(b.vx, b.vy);
      const radial = Math.hypot(b.px, b.py);
      const outwardBefore = radial > 0 ? Math.max(0, (b.vx * b.px + b.vy * b.py) / radial) : 0;
      b.vx = (b.px - b.x) / DT;
      b.vy = (b.py - b.y) / DT;
      if (growth.has(b.id) && radial > 0) {
        // 押しのけに接線方向へ転がる動きは残し、外へ飛ぶ速さだけ増やさない。
        const outward = (b.vx * b.px + b.vy * b.py) / radial;
        const extra = Math.max(0, outward - outwardBefore);
        b.vx -= extra * b.px / radial;
        b.vy -= extra * b.py / radial;
      }
      b.x = b.px;
      b.y = b.py;
      if (b.touching) {
        if (!b.landed) {
          b.landed = true;
          if (b.charged) {
            b.charged = false;
            gravity?.onChargedTouch(b.id, b.tier);
          }
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
      const cap = b.landed ? pileCap : MAX_SPEED;
      if (speed > cap) {
        b.vx *= cap / speed;
        b.vy *= cap / speed;
      }
    }

    driftBoard(bodies);

    // 6. 限界リングと熱量
    // 重力操作で山が動いている間だけ、すでに越えている天体には少し幅を持たせる（判定のちらつき防止）
    const slack = bent ? LIMIT_HYSTERESIS : 0;
    let anyOver = false;
    for (const b of bodies) {
      const limit = b.overLimit ? LIMIT_RADIUS - slack : LIMIT_RADIUS;
      b.overLimit = tick - b.bornTick >= LIMIT_GRACE_TICKS && Math.hypot(b.x, b.y) + b.radius > limit;
      if (b.overLimit) anyOver = true;
    }
    if (anyOver !== overLimit) {
      overLimit = anyOver;
      emit({ kind: anyOver ? 'overLimitStart' : 'overLimitEnd' });
    }
    let rate = anyOver ? HEAT_RISE_PER_SECOND : -HEAT_COOL_PER_SECOND;
    let extraRate = 0;
    if (gravity && bent) {
      // 重力操作の代償: 効いている間は冷めず、操作ごとの熱量が足される
      if (!anyOver && gravity.coolingBlocked()) rate = 0;
      extraRate = gravity.heatPerSecond();
    }
    const withoutIntervention = Math.min(HEAT_MAX, Math.max(0, heat + rate * DT));
    heat = Math.min(HEAT_MAX, Math.max(0, heat + (rate + extraRate) * DT));
    interventionCooling = extraRate < 0 ? Math.max(0, withoutIntervention - heat) : 0;

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
    // 照準の線と実際の射出が食い違わないよう、同じ丸めを通す
    const q = quantizeLaunch(command);
    if (gravity.active()) return predictLaunch(getSnapshot(), q, gravity.flight());
    return predictLaunch(getSnapshot(), q);
  }

  function submitGravity(command: GravityCommand): GravityResult {
    if (!gravityPrototype) {
      if (command.kind !== 'collapse') return { accepted: false, reason: 'disabled' };
      if (over) return { accepted: false, reason: 'gameOver' };
      if (bestTier < INTERVENTION_UNLOCK_TIER) return { accepted: false, reason: 'locked' };
      const shot = inputLog.at(-1);
      if (!shot) return { accepted: false, reason: 'noShot' };
      if (shot.collapseTick !== undefined) return { accepted: false, reason: 'alreadyUsed' };
      if ((tick - shot.tick) / TICK_HZ >= INTERVENTION_WINDOW_SECONDS) return { accepted: false, reason: 'expired' };
    }
    const result = gravity.submit(command, tick, over);
    if (result.accepted) {
      if (!gravityPrototype && command.kind === 'collapse') {
        const index = inputLog.length - 1;
        inputLog[index] = { ...inputLog[index]!, collapseTick: tick };
        emit({ kind: 'collapse', x: 0, y: 0 });
      }
      snapshotCache = null;
    }
    return result;
  }

  function exportState(): SimulationState {
    return {
      format: 6,
      seed,
      rngState: rng.state(),
      tick,
      nextId,
      sequence,
      heat,
      score,
      bestTier,
      over,
      overLimit,
      cooldown,
      pendingEvents: pendingEvents.map(copyEvent),
      bodies: bodies.map((b) => ({ ...b })),
      queue: [queue[0], queue[1], queue[2]],
      bag: bag.exportState(),
      inputLog: inputLog.map((i) => ({ ...i })),
      stats: { ...stats },
      gravity: gravity ? gravity.exportState() : null,
      gravityPrototype,
      interventionCooling,
    };
  }

  return {
    getSnapshot,
    submitLaunch,
    stepFixed,
    predict,
    getInputLog: () => inputLog,
    submitGravity,
    getGravityLog: () => gravity?.log ?? [],
    exportState,
  };
}
