// 端末保存の検査と圧縮。旧JSONも読み、新しく書く入力は共有の可逆codecを使う。
import type { LaunchInput, RunStats } from '../contracts/game';
import type { SimulationSetup } from '../game/simulation';
import { TIER_COUNT } from '../game/constants';
import { decodePlay, encodePlay, MAX_INPUTS } from '../share/codec';
import { REPLAY_FORMAT, type ReplayRecord } from './record';
import { MAX_REPLAY_TICKS } from './limits';

// 読む前に文字数を制限し、巨大なJSONの展開で画面が固まるのを防ぐ。
export const MAX_REPLAY_TEXT_LENGTH = 1024 * 1024;

// ───────── 文字列化 ─────────

/** 入力は共有と同じ可逆の圧縮へ。全体のルール指紋と最終照合値は外側に残す。 */
export function serializeReplay(record: ReplayRecord): string {
  if (record.inputs.some((input) => input.charged === true)) return '';
  const inputs = encodePlay({ ...record, rulesVersion: REPLAY_FORMAT });
  if (!inputs) return '';
  return JSON.stringify({ ...record, packing: 1, inputs });
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
    isFiniteNum(i.vy) &&
    (i.charged === undefined || typeof i.charged === 'boolean')
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

const isTier = (v: unknown): boolean => isNonNegativeInt(v) && v < TIER_COUNT;

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
  if (typeof text !== 'string' || text.length > MAX_REPLAY_TEXT_LENGTH) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = { ...raw } as Record<string, unknown>;
  if (r.packing !== undefined) {
    if (r.packing !== 1 || typeof r.inputs !== 'string') return null;
    const decoded = decodePlay(r.inputs);
    if (!decoded.ok || decoded.play.rulesVersion !== REPLAY_FORMAT ||
      decoded.play.seed !== r.seed || decoded.play.endTick !== r.endTick) return null;
    r.inputs = decoded.play.inputs;
    delete r.packing;
  }
  if (r.format !== REPLAY_FORMAT) return null;
  if (typeof r.rulesVersion !== 'string') return null;
  if (!isNonNegativeInt(r.seed) || r.seed > 0xffffffff) return null;
  if (!Array.isArray(r.inputs) || r.inputs.length > MAX_INPUTS || !r.inputs.every(isInput)) return null;
  if (!isNonNegativeInt(r.endTick) || r.endTick > MAX_REPLAY_TICKS) return null;
  let previous = -1;
  for (const input of r.inputs as LaunchInput[]) {
    if (input.tick < previous || input.tick > r.endTick || input.charged === true) return null;
    previous = input.tick;
  }
  if (!isFiniteNum(r.finalScore)) return null;
  if (!isNonNegativeInt(r.finalBodyCount)) return null;
  if (typeof r.initialHash !== 'string') return null;
  if (typeof r.finalHash !== 'string') return null;
  if (r.phase !== 'active' && r.phase !== 'over') return null;
  if (!isStats(r.stats)) return null;
  if (r.setup !== undefined && !isSetup(r.setup)) return null;
  if (typeof r.createdAt !== 'string' || !Number.isFinite(Date.parse(r.createdAt))) return null;
  return r as unknown as ReplayRecord;
}
