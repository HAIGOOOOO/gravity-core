// 重力操作（試作）。握る・井戸・渦の状態と、その力・代償の計算。
// 画面・現在時刻・乱数を使わない。同じ入力なら同じ結果になる。
//
// 何も操作していない間は active() が false を返し、simulation.ts は元の計算をそのまま使う。
// そのため、重力操作を使わない限り、結果は今までと 1 tick も変わらない。

import type { GravityCommand, GravityInput, GravityResult, GravityView, Tick, Tier } from '../contracts/game';
import {
  AIR_DAMPING,
  CORE_RADIUS,
  DT,
  GRAVITY,
  GRIP_BODY_SPEED_CAP,
  GRIP_DRAG,
  GRIP_HEAT_PER_SECOND,
  GRIP_MAX_HOLD_SECONDS,
  GRIP_PULL_ACCEL,
  GRIP_PULL_RANGE,
  GRIP_SQUEEZE_GRAVITY,
  GRIP_SQUEEZE_SECONDS,
  GRIP_SWELL_ACCEL,
  GRIP_SWELL_LIMIT_RADIUS,
  LAUNCH_RADIUS,
  LIMIT_RADIUS,
  TICK_HZ,
  VORTEX_ACCEL,
  VORTEX_DEPTH,
  VORTEX_FOLLOW,
  VORTEX_HEAT_PER_SECOND,
  VORTEX_INNER_FACTOR,
  VORTEX_SPIN_DOWN_SECONDS,
  VORTEX_SPEED,
  VORTEX_SPIN_UP_SECONDS,
  WELL_ACCEL,
  WELL_CORE_DAMPING,
  WELL_FADE_SECONDS,
  WELL_HEAT_PER_SECOND,
  WELL_MAX_CHARGES,
  WELL_MERGES_PER_CHARGE,
  WELL_PILE_FACTOR,
  WELL_RADIUS,
  WELL_SECONDS,
  WELL_SOFT_RADIUS,
  WELL_START_CHARGES,
} from './constants';
import type { Mover } from './physics';

/**
 * 見本ページのスライダーで変えられる数値。既定値は constants.ts。
 * 計算は毎 tick ここを読むので、遊んでいる途中に書き換えるとすぐ効く。
 * ただし途中で書き換えた回は、入力の記録だけでは再現できない（記録に数値の変更は残らない）。
 */
export type GravityTuning = {
  gripSwellAccel: number;
  gripDrag: number;
  gripMaxHoldSeconds: number;
  gripHeatPerSecond: number;
  gripSqueezeSeconds: number;
  gripSqueezeGravity: number;
  gripPullAccel: number;
  gripPullRange: number;
  wellAccel: number;
  wellRadius: number;
  wellSeconds: number;
  wellPileFactor: number;
  wellMaxCharges: number;
  wellMergesPerCharge: number;
  wellHeatPerSecond: number;
  vortexSpeed: number;
  vortexAccel: number;
  vortexDepth: number;
  vortexInnerFactor: number;
  vortexSpinUpSeconds: number;
  vortexSpinDownSeconds: number;
  vortexHeatPerSecond: number;
};

export function defaultGravityTuning(): GravityTuning {
  return {
    gripSwellAccel: GRIP_SWELL_ACCEL,
    gripDrag: GRIP_DRAG,
    gripMaxHoldSeconds: GRIP_MAX_HOLD_SECONDS,
    gripHeatPerSecond: GRIP_HEAT_PER_SECOND,
    gripSqueezeSeconds: GRIP_SQUEEZE_SECONDS,
    gripSqueezeGravity: GRIP_SQUEEZE_GRAVITY,
    gripPullAccel: GRIP_PULL_ACCEL,
    gripPullRange: GRIP_PULL_RANGE,
    wellAccel: WELL_ACCEL,
    wellRadius: WELL_RADIUS,
    wellSeconds: WELL_SECONDS,
    wellPileFactor: WELL_PILE_FACTOR,
    wellMaxCharges: WELL_MAX_CHARGES,
    wellMergesPerCharge: WELL_MERGES_PER_CHARGE,
    wellHeatPerSecond: WELL_HEAT_PER_SECOND,
    vortexSpeed: VORTEX_SPEED,
    vortexAccel: VORTEX_ACCEL,
    vortexDepth: VORTEX_DEPTH,
    vortexInnerFactor: VORTEX_INNER_FACTOR,
    vortexSpinUpSeconds: VORTEX_SPIN_UP_SECONDS,
    vortexSpinDownSeconds: VORTEX_SPIN_DOWN_SECONDS,
    vortexHeatPerSecond: VORTEX_HEAT_PER_SECOND,
  };
}

/** 力を受ける天体。landed が false の物は「撃ってまだ何にも触れていない天体」。 */
export type GravityBody = Mover & { tier: Tier; radius: number; landed: boolean };

/** 予測用: 撃った天体を、今の重力操作のもとで 1 tick ずつ進める。 */
export type FlightModel = {
  step(shot: Mover): void;
  /** 山が大きく動いていて、当たり先を言い切れない */
  uncertain: boolean;
};

type Well = { x: number; y: number; leftTicks: number };
type Dir = -1 | 0 | 1;

const WELL_FADE_TICKS = Math.max(1, Math.round(WELL_FADE_SECONDS * TICK_HZ));

function ticksOf(seconds: number): number {
  return Math.max(1, Math.round(seconds * TICK_HZ));
}

/** 渦の回転の強さを 1 tick ぶん進める。押している向きへ近づき、離すと惰性でゆっくり止まる。 */
function nextSpin(spin: number, dir: Dir, tuning: GravityTuning): number {
  if (dir !== 0) {
    const step = DT / Math.max(tuning.vortexSpinUpSeconds, DT);
    return dir > 0 ? Math.min(1, spin + step) : Math.max(-1, spin - step);
  }
  const step = DT / Math.max(tuning.vortexSpinDownSeconds, DT);
  return spin > 0 ? Math.max(0, spin - step) : Math.min(0, spin + step);
}

/** 井戸の引力を速度に足す。factor は効きの割合（山は弱く引かれる）。 */
function applyWell(b: Mover, well: Well, tuning: GravityTuning, factor: number): void {
  const dx = well.x - b.x;
  const dy = well.y - b.y;
  const d2 = dx * dx + dy * dy;
  const reach = tuning.wellRadius;
  if (d2 >= reach * reach) return;
  const d = Math.sqrt(d2);
  // 消える直前は弱める。中心に近いほど力を 0 に寄せる（中心で向きが跳ねて震えるのを防ぐ）
  const fade = Math.min(1, well.leftTicks / WELL_FADE_TICKS);
  const a = (tuning.wellAccel * factor * fade * (1 - d / reach)) / Math.sqrt(d2 + WELL_SOFT_RADIUS * WELL_SOFT_RADIUS);
  b.vx += a * dx * DT;
  b.vy += a * dy * DT;
  // 中心付近では減速を足し、行ったり来たりを収める
  const core = WELL_SOFT_RADIUS * 2;
  if (d < core) {
    const keep = 1 - WELL_CORE_DAMPING * fade * (1 - d / core) * DT;
    b.vx *= keep;
    b.vy *= keep;
  }
}

/**
 * 渦の横向きの力を速度に足す。限界リングに近いほど強く、深い所には届かない。
 * 「加速度を足し続ける」のではなく「流れの速さへ近づける」形にしてある。
 * こうすると速さに上限ができ、浮いた天体が加速し続けて盤面の外へ飛び出すことがない。
 */
function applyVortex(b: Mover, r: number, spin: number, tuning: GravityTuning): void {
  if (r <= 1e-6) return;
  const depth = Math.max(1, tuning.vortexDepth);
  const t = Math.min(1, Math.max(0, (r - (LIMIT_RADIUS - depth)) / depth));
  const w = tuning.vortexInnerFactor + (1 - tuning.vortexInnerFactor) * t;
  if (w <= 0) return;
  const tx = -b.y / r;
  const ty = b.x / r;
  const want = spin * tuning.vortexSpeed * w - (b.vx * tx + b.vy * ty);
  const max = tuning.vortexAccel * w;
  const a = Math.min(max, Math.max(-max, VORTEX_FOLLOW * want));
  b.vx += tx * a * DT;
  b.vy += ty * a * DT;
}

/** 撃った天体（まだ何にも触れていない）にかかる力。本番の計算と予測の両方がこれを使う。 */
function applyShotForces(b: Mover, well: Well | null, spin: number, tuning: GravityTuning): void {
  const r = Math.hypot(b.x, b.y);
  if (r > 1e-6) {
    b.vx -= (GRAVITY * b.x * DT) / r;
    b.vy -= (GRAVITY * b.y * DT) / r;
  }
  if (well) applyWell(b, well, tuning, 1);
  if (spin !== 0) applyVortex(b, r, spin, tuning);
  const keep = 1 - AIR_DAMPING * DT;
  b.vx *= keep;
  b.vy *= keep;
}

export type Gravity = ReturnType<typeof createGravity>;

export function createGravity(tuning: GravityTuning) {
  let gripHeld = false;
  let gripTicks = 0;
  let squeezeLeft = 0;
  let squeezeCharge = 0;
  let well: Well | null = null;
  let charges = Math.min(WELL_START_CHARGES, tuning.wellMaxCharges);
  let mergeProgress = 0;
  let dir: Dir = 0;
  let spin = 0;
  const log: GravityInput[] = [];
  // 締まっている間、各天体が引かれる相手（いちばん近い同じ Tier）を探すための作業用
  const partner: number[] = [];
  const partnerGap: number[] = [];

  const gripCharge = (): number => Math.min(1, gripTicks / ticksOf(tuning.gripMaxHoldSeconds));

  function release(): void {
    gripHeld = false;
    squeezeCharge = gripCharge();
    squeezeLeft = ticksOf(tuning.gripSqueezeSeconds);
    gripTicks = 0;
  }

  function check(command: GravityCommand, over: boolean): GravityResult {
    if (over) return { accepted: false, reason: 'gameOver' };
    switch (command.kind) {
      case 'grip':
        if (command.on === gripHeld) return { accepted: false, reason: 'noChange' };
        if (command.on && squeezeLeft > 0) return { accepted: false, reason: 'busy' };
        return { accepted: true };
      case 'well': {
        const r = Math.hypot(command.x, command.y);
        if (!(r >= CORE_RADIUS && r <= LAUNCH_RADIUS)) return { accepted: false, reason: 'outOfBoard' };
        if (well) return { accepted: false, reason: 'busy' };
        if (charges <= 0) return { accepted: false, reason: 'noCharge' };
        return { accepted: true };
      }
      case 'vortex':
        if (command.dir === dir) return { accepted: false, reason: 'noChange' };
        return { accepted: true };
    }
  }

  function submit(command: GravityCommand, tick: Tick, over: boolean): GravityResult {
    const result = check(command, over);
    if (!result.accepted) return result;
    switch (command.kind) {
      case 'grip':
        if (command.on) {
          gripHeld = true;
          gripTicks = 0;
        } else release();
        break;
      case 'well':
        charges--;
        well = { x: command.x, y: command.y, leftTicks: ticksOf(tuning.wellSeconds) };
        break;
      case 'vortex':
        dir = command.dir;
        break;
    }
    log.push({ tick, command });
    return result;
  }

  /** tick の最初に呼ぶ。握りの時間切れ、井戸の残り時間、渦の回転を進める。 */
  function advance(): void {
    if (gripHeld) {
      gripTicks++;
      // 握りっぱなしで山が無限にふくらまないよう、最長で自動的に離す
      if (gripTicks >= ticksOf(tuning.gripMaxHoldSeconds)) release();
    } else if (squeezeLeft > 0) squeezeLeft--;
    if (well && --well.leftTicks <= 0) well = null;
    if (dir !== 0 || spin !== 0) spin = nextSpin(spin, dir, tuning);
  }

  /** 何かの効果が効いている。false の間は元の計算をそのまま使う。 */
  function active(): boolean {
    return gripHeld || squeezeLeft > 0 || well !== null || spin !== 0 || dir !== 0;
  }

  /** 締まっている間、同じ Tier のいちばん近い相手へ引き寄せる。 */
  function applyPull(bodies: readonly GravityBody[]): void {
    const range = tuning.gripPullRange * squeezeCharge;
    if (range <= 0) return;
    const n = bodies.length;
    for (let i = 0; i < n; i++) {
      partner[i] = -1;
      partnerGap[i] = range;
    }
    for (let i = 0; i < n; i++) {
      const a = bodies[i]!;
      if (!a.landed) continue;
      for (let j = i + 1; j < n; j++) {
        const b = bodies[j]!;
        if (!b.landed || b.tier !== a.tier) continue;
        const gap = Math.hypot(b.x - a.x, b.y - a.y) - a.radius - b.radius;
        if (gap < partnerGap[i]!) {
          partnerGap[i] = gap;
          partner[i] = j;
        }
        if (gap < partnerGap[j]!) {
          partnerGap[j] = gap;
          partner[j] = i;
        }
      }
    }
    // 相手の「引く前の位置」で向きを決めたいので、速度だけを変える（位置はこの後で動く）
    for (let i = 0; i < n; i++) {
      const j = partner[i]!;
      if (j < 0) continue;
      const a = bodies[i]!;
      const b = bodies[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d <= 1e-6) continue;
      a.vx += (tuning.gripPullAccel * dx * DT) / d;
      a.vy += (tuning.gripPullAccel * dy * DT) / d;
    }
  }

  /** 全天体に、この tick の力を速度へ反映する（元の applyGravity の代わり）。 */
  function applyForces(bodies: readonly GravityBody[]): void {
    for (const b of bodies) {
      if (!b.landed) {
        applyShotForces(b, well, spin, tuning);
        continue;
      }
      const r = Math.hypot(b.x, b.y);
      let g = GRAVITY;
      let drag = AIR_DAMPING;
      if (gripHeld) {
        // 外へ押す。端が上限を越えた物はそれ以上押さない（盤面の外まで広がらないように）
        g = r + b.radius < GRIP_SWELL_LIMIT_RADIUS ? -tuning.gripSwellAccel : 0;
        drag = tuning.gripDrag;
      } else if (squeezeLeft > 0) g = GRAVITY * tuning.gripSqueezeGravity;
      if (r > 1e-6) {
        b.vx -= (g * b.x * DT) / r;
        b.vy -= (g * b.y * DT) / r;
      }
      if (well) applyWell(b, well, tuning, tuning.wellPileFactor);
      if (spin !== 0) applyVortex(b, r, spin, tuning);
      const keep = 1 - drag * DT;
      b.vx *= keep;
      b.vy *= keep;
    }
    if (squeezeLeft > 0 && !gripHeld) applyPull(bodies);
  }

  /** 合体のたびに呼ぶ。井戸の持ち数をためる。 */
  function onMerge(): void {
    if (charges >= tuning.wellMaxCharges) return;
    mergeProgress++;
    if (mergeProgress >= tuning.wellMergesPerCharge) {
      mergeProgress = 0;
      charges++;
    }
  }

  /** 山の天体の速さの上限。握り・締まりの間だけ低くする。それ以外は normal をそのまま返す。 */
  function pileSpeedCap(normal: number): number {
    return gripHeld || squeezeLeft > 0 ? Math.min(normal, GRIP_BODY_SPEED_CAP) : normal;
  }

  /** 重力操作が足す熱量（毎秒）。 */
  function heatPerSecond(): number {
    return (
      (gripHeld ? tuning.gripHeatPerSecond : 0) +
      Math.abs(spin) * tuning.vortexHeatPerSecond +
      (well ? tuning.wellHeatPerSecond : 0)
    );
  }

  /** 重力操作の間は熱量が冷めない。 */
  function coolingBlocked(): boolean {
    return gripHeld || squeezeLeft > 0 || well !== null || spin !== 0;
  }

  /** 山が大きく動いている（握り・締まり・渦）。井戸は山を少ししか動かさないので含めない。 */
  function unstable(): boolean {
    return gripHeld || squeezeLeft > 0 || spin !== 0 || dir !== 0;
  }

  /**
   * 予測用の進め方を作る。「いまの入力がそのまま続く」と仮定する
   * （渦は押したまま／離したまま、井戸は残り時間で消える）。握りは撃った天体には効かない。
   */
  function flight(): FlightModel {
    const w: Well | null = well ? { ...well } : null;
    let wellNow = w;
    let s = spin;
    return {
      uncertain: unstable(),
      step(shot) {
        if (wellNow && --wellNow.leftTicks <= 0) wellNow = null;
        if (dir !== 0 || s !== 0) s = nextSpin(s, dir, tuning);
        applyShotForces(shot, wellNow, s, tuning);
        shot.x += shot.vx * DT;
        shot.y += shot.vy * DT;
      },
    };
  }

  function view(): GravityView {
    return {
      grip: {
        held: gripHeld,
        charge: gripHeld ? gripCharge() : squeezeLeft > 0 ? squeezeCharge : 0,
        squeezeLeftSeconds: squeezeLeft / TICK_HZ,
        pullRange: tuning.gripPullRange * (gripHeld ? gripCharge() : squeezeLeft > 0 ? squeezeCharge : 0),
      },
      well: well ? { x: well.x, y: well.y, leftSeconds: well.leftTicks / TICK_HZ, radius: tuning.wellRadius } : null,
      wellCharges: charges,
      wellMergeProgress: mergeProgress,
      vortex: { dir, spin },
      unstable: unstable(),
      coolingBlocked: coolingBlocked(),
      heatPerSecond: heatPerSecond(),
    };
  }

  return { submit, advance, active, applyForces, onMerge, pileSpeedCap, heatPerSecond, coolingBlocked, unstable, flight, view, log };
}
