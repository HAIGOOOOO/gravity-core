// 自動プレイのボット。盤面（GameSnapshot）と予測（predict）だけを見て次の射出を決める。
// シミュレーションの中身（Body の内部状態など）は覗かない。
// 全部決定的: 同じシードで作ったボットは同じ動きをする（乱数は createRng だけ）。
//
// 決め事:
//   - decide が呼ばれるのは「撃てる時」（待ち時間が終わった時）だけ。必ず LaunchCommand を返す。
//   - 予測が invalid（射出点が塞がっている等）の方角は選ばない。全部駄目なら回転した方角へ落とす
//     （その射出は断られるが、盤面が動いて次は撃てる。呼び側は断られたら少し進めて再度呼ぶ）。

import type { GameSnapshot, LaunchCommand, Prediction } from '../contracts/game';
import { dropAt } from '../fixtures/index';
import {
  DRAG_MAX_PX,
  DRAG_MIN_PX,
  LIMIT_RADIUS,
  SPEED_MAX,
  SPEED_MIN,
  TIER_RADIUS,
} from '../game/constants';
import { createRng, type Rng } from '../game/rng';
import { aimVelocity } from '../shared/launch';

export type PredictFn = (command: LaunchCommand) => Prediction;

export interface Bot {
  /** レポートの行名に使う */
  readonly name: string;
  /** 次の射出を決める。盤面と予測だけを見る。 */
  decide(snapshot: GameSnapshot, predict: PredictFn): LaunchCommand;
}

/** 1 回のプレイに 1 つ作る。シードごとに作り直すのでファクトリの形にする。 */
export type BotFactory = (seed: number) => Bot;

const FULL_TURN = Math.PI * 2;
/** まっすぐ落とす系は 48 方角、曲げる系は 5 通り掛かるので 24 方角を調べる */
const STRAIGHT_ANGLES = 48;
const CURVE_ANGLES = 24;
/** 曲げる速さは最速と中間の 2 段階 */
const CURVE_SPEEDS = [SPEED_MAX, (SPEED_MIN + SPEED_MAX) / 2];

/** 方角の刻みと、そこから作る射出の候補。2 つは必ず対なので、ずれないよう 1 つにまとめて渡す */
type Probe = Readonly<{
  angleCount: number;
  commandsFor: (angle: number) => readonly LaunchCommand[];
}>;

// ---------------------------------------------------------------------------
// 共通の部品

/**
 * 予測の着地点が「安全」か。
 * 危ない = 天体に当たって止まる場所が限界リングの外（そのまま残ると熱量を上げ続ける）。
 * end === 'core' は核に着くので安全。'timeLimit' は行き先が分からないので危ない側に数える。
 */
export function isSafeLanding(p: Prediction, snapshot: GameSnapshot, shotRadius: number): boolean {
  if (p.end === 'core') return true;
  if (p.end !== 'body') return false;
  const last = p.points[p.points.length - 1];
  if (last && Math.hypot(last.x, last.y) + shotRadius > LIMIT_RADIUS) return false;
  const hit = snapshot.bodies.find((b) => b.id === p.hitBodyId);
  return !(hit?.overLimit ?? false);
}

/**
 * 方角を舐めて一番良い射出を選ぶ。
 * 順位: 合体できる（rank 0）> 安全に着地できる（rank 1）> リングを越えそう（rank 2）。
 * avoidRisky = false なら rank 2 を rank 1 と同じ扱いにする（越えそうでも気にしない）。
 * 同じ順位なら score が大きい方。全部同じなら先に見つけた方（直投げを曲げより優先）。
 */
function pickCommand(
  snapshot: GameSnapshot,
  predict: PredictFn,
  startIndex: number,
  probe: Probe,
  avoidRisky: boolean,
): LaunchCommand {
  const { angleCount, commandsFor } = probe;
  let best: { command: LaunchCommand; rank: number; score: number } | null = null;
  for (let i = 0; i < angleCount; i++) {
    const angle = ((startIndex + i) % angleCount) * (FULL_TURN / angleCount);
    for (const command of commandsFor(angle)) {
      const p = predict(command);
      if (!p.valid) continue;
      let rank: number;
      let score = 0;
      if (p.willMerge) {
        rank = 0;
        const hit = snapshot.bodies.find((b) => b.id === p.hitBodyId);
        // 連鎖が続く相手ほど、また大きい Tier ほど先に合体させる
        score = (hit && hit.chainUntilTick > snapshot.tick ? hit.chain : 0) * 10 + (hit?.tier ?? 0);
      } else {
        const safe = isSafeLanding(p, snapshot, TIER_RADIUS[snapshot.nextQueue[0]]);
        rank = safe || !avoidRisky ? 1 : 2;
        // 同じ順位の中では、空き地（核）より既にある天体に寄せる方を少し優先する
        score = p.end === 'body' ? 1 : 0;
      }
      if (best === null || rank < best.rank || (rank === best.rank && score > best.score)) {
        best = { command, rank, score };
      }
    }
  }
  if (best !== null) return best.command;
  // 全部 invalid だった: とりあえず回した方角へ（断られても盤面が動けば次は撃てる）
  return dropAt((startIndex % angleCount) * (FULL_TURN / angleCount));
}

/** 予測で方角を舐めるボットを作る共通部品。毎回の開始位置だけ乱数で回す。 */
function makeAimingBot(name: string, rng: Rng, probe: Probe, avoidRisky: boolean): Bot {
  return {
    name,
    decide(snapshot, predict) {
      const start = Math.floor(rng() * probe.angleCount);
      return pickCommand(snapshot, predict, start, probe, avoidRisky);
    },
  };
}

function straightOnly(angle: number): readonly LaunchCommand[] {
  return [dropAt(angle)];
}

/** 接線方向へ 2 段階の速さで投げる候補を、直投げに足して返す。 */
function straightAndCurves(angle: number): readonly LaunchCommand[] {
  const commands: LaunchCommand[] = [dropAt(angle)];
  // 接線の単位ベクトル（時計回り）。外向き成分は aimVelocity が取り除く
  const tx = -Math.sin(angle);
  const ty = Math.cos(angle);
  for (const speed of CURVE_SPEEDS) {
    const drag = DRAG_MIN_PX + ((speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * (DRAG_MAX_PX - DRAG_MIN_PX);
    for (const dir of [1, -1]) {
      const v = aimVelocity(angle, tx * dir * drag, ty * dir * drag);
      commands.push({ originAngleRadians: angle, vx: v.vx, vy: v.vy });
    }
  }
  return commands;
}

/** 直投げだけを調べる探しかた */
const STRAIGHT_PROBE: Probe = { angleCount: STRAIGHT_ANGLES, commandsFor: straightOnly };
/** 直投げに曲げを足して調べる探しかた */
const CURVE_PROBE: Probe = { angleCount: CURVE_ANGLES, commandsFor: straightAndCurves };

// ---------------------------------------------------------------------------
// ボット本体

/** ① 方角を無作為にまっすぐ落とす（比較の基準）。 */
export const randomBot: BotFactory = (seed) => {
  const rng = createRng(seed + 101);
  return {
    name: 'random',
    decide: () => dropAt(rng() * FULL_TURN),
  };
};

/** 予測を使わず、黄金比ずつ方角を回して落とす（全部の方角を均等に試す）。 */
export const spiralBot: BotFactory = (seed) => {
  const golden = Math.PI * (3 - Math.sqrt(5));
  let k = seed;
  return {
    name: 'spiral',
    decide: () => dropAt((k++ * golden) % FULL_TURN),
  };
};

/** ② 予測で「同じ Tier に当たる」方角を探して落とす。見つからなければどこかへ落とす。 */
export const mergeBot: BotFactory = (seed) =>
  makeAimingBot('merge', createRng(seed + 202), STRAIGHT_PROBE, false);

/** ③ ②に加えて、限界リングを越えそうな方角を避ける。 */
export const safeMergeBot: BotFactory = (seed) =>
  makeAimingBot('merge-safe', createRng(seed + 303), STRAIGHT_PROBE, true);

/** ④ ③の探しかたに、接線方向へ投げる「曲げ」を足す（直投げで届かない裏側を狙える）。 */
export const curveBot: BotFactory = (seed) =>
  makeAimingBot('curve', createRng(seed + 404), CURVE_PROBE, true);

/** 全部のボット（レポートやテストでまとめて回す用）。 */
export const ALL_BOTS: readonly BotFactory[] = [randomBot, spiralBot, mergeBot, safeMergeBot, curveBot];
