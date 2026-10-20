// 1 回のプレイをそっくり再生するための記録。
// 同じシードと同じ入力なら src/game/ の計算は必ず同じ結果になるので、
// 記録には盤面ではなく「シードと入力ログ」を持つ。
// ルール（constants.ts の数値）が変わると同じ手順でも結果が変わるため、
// ルールの版の指紋を一緒に保存し、合わない記録は再生しない。

import type { GameSnapshot, LaunchInput, RunStats, SimulationPort, Tick } from '../contracts/game';
import * as RULE_CONSTANTS from '../game/constants';
import { createSimulation, type SimulationSetup } from '../game/simulation';

/** 保存形式の版。記録の形や入力の種類が増えたら上げる。 */
export const REPLAY_FORMAT = 5; // 5: 固定組の袋から順に出す（2026-10-21）

export type ReplayRecord = Readonly<{
  format: typeof REPLAY_FORMAT;
  /** rulesVersion() が作る指紋。今のルールと違う記録は「合わない」結果を返す */
  rulesVersion: string;
  seed: number;
  /** 受理された射出の時系列ログ（SimulationPort.getInputLog()）。拒否された射出は含まれない */
  inputs: readonly LaunchInput[];
  /** 記録した時点の tick */
  endTick: Tick;
  finalScore: number;
  finalBodyCount: number;
  /**
   * 開始時（tick 0・入力を反映する前）の盤面の指紋。
   * finalHash だけでは、終わる頃に同じ状態へ収束する細工を見逃す
   * （例: 開始時の熱量を足しても、その後の冷却で最終盤面が同じになる）。
   * 開始の指紋も持つことで、seed・setup・初期キューの書き換えが全部「合わない」と分かる。
   */
  initialHash: string;
  /**
   * 記録した時点の盤面の指紋（snapshotHash）。
   * 得点・tick・天体・熱量・キュー全部を畳んだ物なので、入力を抜く・得点を盛る・
   * endTick を延ばす等の書き換えは全部ここで「合わない」と分かる。
   */
  finalHash: string;
  phase: 'active' | 'over';
  stats: RunStats;
  /**
   * 特別な開始状態から始めたプレイだけ持つ（通常のプレイでは無い）。
   * 開始時の盤面・熱量・キュー・到達 Tier を変えたシミュレーションは、
   * これが無いとシードと入力だけでは再現できない。
   */
  setup?: SimulationSetup;
  /** ISO 8601 */
  createdAt: string;
}>;

// ───────── ルールの版 ─────────
// constants.ts が export する値のうち、再生の正しさに関係しない物
// （見た目・音・照準の変換だけに使う数値）を除いた全部を JSON 化して FNV-1a で畳む。
// 新しい定数は既定で指紋に入る。入れ忘れて古い再生を「合う」と誤認する方が
// 危ないので、関係ない変化で古い再生が弾かれる分には許容する。
const NON_RULE_CONSTANTS: ReadonlySet<string> = new Set([
  'AIM_MIN_RADIUS',
  'DRAG_MIN_PX',
  'DRAG_MAX_PX',
  'PREDICT_SECONDS',
  'PREDICT_SAMPLE_SECONDS',
  'MAX_FRAME_SECONDS',
  'MAX_STEPS_PER_FRAME',
  'TRAIL_SECONDS',
  'TRAIL_POINTS',
  'PARTICLE_CAP',
  'FLOAT_TEXT_CAP',
  'GAMEOVER_SECONDS',
  'AUDIO_MAX_VOICES',
  'LAND_SOUND_WINDOW_SECONDS',
  'LAND_SOUND_MAX',
  'AUDIO_MASTER_GAIN',
  'DPR_CAP',
  'TIER_NAMES',
  'TIER_COLOR',
]);

let versionCache: string | null = null;

/** FNV-1a。同じ文字列なら必ず同じ 8 桁の指紋。 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * いまのルールの指紋。同じ数値なら必ず同じ文字列、1 つでも変われば変わる。
 * `r<形式>.<8桁のhash>` の形にする。
 */
export function rulesVersion(): string {
  if (versionCache) return versionCache;
  const values = RULE_CONSTANTS as unknown as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(values).sort()) {
    if (NON_RULE_CONSTANTS.has(key)) continue;
    parts.push(`${key}=${JSON.stringify(values[key])}`);
  }
  versionCache = `r${REPLAY_FORMAT}.${fnv1a(parts.join('|'))}`;
  return versionCache;
}

/**
 * 盤面の指紋。GameSnapshot をそのまま JSON 化して畳む。
 * tick・天体・得点・熱量・キューのどれか 1 つでも違えば変わる。
 * 計算し直した盤面と記録の照合に使う（src/game/ は決定的なので同じ盤面は同じ文字列）。
 */
export function snapshotHash(snap: GameSnapshot): string {
  return fnv1a(JSON.stringify(snap));
}

// ───────── 記録を作る ─────────

// 呼び出し側があとで setup を書き換えても記録が腐らないよう、中身を複製する。
// （inputs と stats は最初から複製している。ここだけ参照のままだった）
// player も、カーソルがあとから読む setup の複製にこれを使う。
export function copySetup(setup: SimulationSetup): SimulationSetup {
  const copy: SimulationSetup = { ...setup };
  if (setup.bodies) copy.bodies = setup.bodies.map((b) => ({ ...b }));
  if (setup.queue) copy.queue = [...setup.queue];
  return copy;
}

/**
 * プレイ中（あるいは終了後）のシミュレーションから記録を作る。
 * 盤面は持たず、シードと受理済みの入力ログを写す。
 *
 * createSimulation に setup を渡して始めたプレイでは、同じ物を options.setup に
 * 渡すこと。SimulationPort は開始状態を外に出さないので、渡さないと
 * 「通常開始の記録」として保存され、再生時に開始の盤面が合わず
 * 必ず diverged になる（黙って再現できない記録を作るより、分かる方が安全）。
 */
export function createReplayRecord(
  sim: SimulationPort,
  options: { now?: Date; setup?: SimulationSetup } = {},
): ReplayRecord {
  const snap = sim.getSnapshot();
  const record: ReplayRecord = {
    format: REPLAY_FORMAT,
    rulesVersion: rulesVersion(),
    seed: snap.seed,
    inputs: sim.getInputLog().map((i) => ({ ...i })),
    endTick: snap.tick,
    finalScore: snap.score,
    finalBodyCount: snap.bodies.length,
    // 開始の盤面はシードと setup だけで決まるので、同じ組み立てで作り直して指紋を取る
    initialHash: snapshotHash(createSimulation(snap.seed, options.setup).getSnapshot()),
    finalHash: snapshotHash(snap),
    phase: snap.phase,
    stats: { ...snap.stats },
    createdAt: (options.now ?? new Date()).toISOString(),
  };
  // 通常の開始（既定の 1 体だけの盤面）では setup は付けない
  return options.setup === undefined ? record : { ...record, setup: copySetup(options.setup) };
}

// ───────── 文字列化 ─────────

export function serializeReplay(record: ReplayRecord): string {
  return JSON.stringify(record);
}

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNonNegativeInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function isInput(v: unknown): v is LaunchInput {
  if (typeof v !== 'object' || v === null) return false;
  const i = v as Record<string, unknown>;
  return (
    isNonNegativeInt(i.tick) &&
    isFiniteNum(i.originAngleRadians) &&
    isFiniteNum(i.vx) &&
    isFiniteNum(i.vy)
  );
}

function isStats(v: unknown): v is RunStats {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    isNonNegativeInt(s.launches) &&
    isNonNegativeInt(s.merges) &&
    isNonNegativeInt(s.supernovas) &&
    isNonNegativeInt(s.maxChain)
  );
}

const isTier = (v: unknown): boolean => isNonNegativeInt(v) && v <= 8;

function isSetup(v: unknown): v is SimulationSetup {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  if (s.bodies !== undefined) {
    if (!Array.isArray(s.bodies)) return false;
    for (const b of s.bodies) {
      if (typeof b !== 'object' || b === null) return false;
      const body = b as Record<string, unknown>;
      if (!isTier(body.tier) || !isFiniteNum(body.x) || !isFiniteNum(body.y)) return false;
      if (body.vx !== undefined && !isFiniteNum(body.vx)) return false;
      if (body.vy !== undefined && !isFiniteNum(body.vy)) return false;
    }
  }
  if (s.heat !== undefined && !isFiniteNum(s.heat)) return false;
  if (s.queue !== undefined && (!Array.isArray(s.queue) || s.queue.length !== 3 || !s.queue.every(isTier))) return false;
  if (s.bestTier !== undefined && !isTier(s.bestTier)) return false;
  return true;
}

/**
 * serializeReplay の文字列を読み戻す。形が合わない物・壊れた物は null。
 * 「ルールに合うか」はここでは見ない（createReplayPlayer が判定する）。
 */
export function parseReplay(text: string): ReplayRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.format !== REPLAY_FORMAT) return null;
  if (typeof r.rulesVersion !== 'string') return null;
  if (!isFiniteNum(r.seed)) return null;
  if (!Array.isArray(r.inputs) || !r.inputs.every(isInput)) return null;
  if (!isNonNegativeInt(r.endTick)) return null;
  if (!isFiniteNum(r.finalScore)) return null;
  if (!isNonNegativeInt(r.finalBodyCount)) return null;
  if (typeof r.initialHash !== 'string') return null;
  if (typeof r.finalHash !== 'string') return null;
  if (r.phase !== 'active' && r.phase !== 'over') return null;
  if (!isStats(r.stats)) return null;
  if (r.setup !== undefined && !isSetup(r.setup)) return null;
  if (typeof r.createdAt !== 'string') return null;
  return r as unknown as ReplayRecord;
}
