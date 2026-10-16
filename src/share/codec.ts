// 1 回のプレイを短い文字列にする、と読み戻す。
// 同じシードと同じ入力なら必ず同じ結果になるので、中身は「シード + 入力ログ + ルールの版」だけ。
//
// バイト列の形:
//   [u8]     形式の版（SHARE_FORMAT_VERSION）
//   [varint] rulesVersion（RULES.md の版）
//   [varint] seed
//   [varint] endTick（ここまで再生する。未終了のプレイも共有できるようにするため）
//   [varint] 入力の数
//   入力ごと: [varint（前の入力からの tick 差 ×4 + 種別）] + 中身
//     種別 0: u32le の k → 角度 = (k / 2^32) * π * 2。速度は「まっすぐ落とす」で計算し直す
//     種別 1: f64 の角度。速度は同上で計算し直す
//     種別 2: f64 の角度・vx・vy をそのまま
//   [u32le]  ここまで全部の FNV-1a（壊れを見つける検査値）
// 文字は URL に入れても壊れない base64url（padding なし）。
//
// 値の入れ方について: この物理は小さなズレが接触判定を経て増幅しうるので、
// 値を丸めて小さくする代わりに「同じ計算で出せる値は計算し直す」方式にした。
// 「まっすぐ落とす」（速度 -cos(角度)*DROP_SPEED, -sin(角度)*DROP_SPEED）は角度だけで復元できる。
// その中でも角度が 2π/2^32 の格子に乗る入力（createRng 由来 = 自動プレイ全部）は 4 バイト。
// 格子に乗らない「まっすぐ落とす」は 8 バイト、それ以外（投げる）は 24 バイトで
// 値のビットをそのまま入れる。どの経路でも誤差は 0 で、再生は元のプレイと完全に一致する。

import type { LaunchInput } from '../contracts/game';
import { DROP_SPEED, TICK_HZ } from '../game/constants';
import {
  base64UrlToBytes,
  bytesToBase64Url,
  fnv1a,
  readF64,
  readU32,
  readVarint,
  writeF64,
  writeU32,
  writeVarint,
} from './coding';

/** この文字列形式の版。形を変えたら +1 する。 */
export const SHARE_FORMAT_VERSION = 1;
/** いまのルールの版。RULES.md のルールが変わったら +1 する（リーダー管理）。 */
export const SHARE_RULES_VERSION = 1;

/**
 * 文字列の長さの上限。4 時間ぶんの「まっすぐ落とし」連打（約 2.9 万入力）でも十分入る大きさ。
 * 実際の入力数の上限はこちらが先に効く（全部「投げる」だと約 8,000 入力で頭打ち）。
 */
const MAX_TEXT_LENGTH = 262_144;
/** 入力の数の上限。文字列の上限より先に効くことはほぼないが、読む側の安全として置く。 */
const MAX_INPUTS = 100_000;
/** プレイの長さの上限 = 4 時間（tick）。これを越える記録は壊れた物とみなす。 */
const MAX_TICKS = TICK_HZ * 60 * 60 * 4;

const TAG_DROP_GRID = 0;
const TAG_DROP = 1;
const TAG_RAW = 2;
/** 2^32。createRng が返す値の分母で、自動プレイの角度は必ずこの格子に乗る。 */
const GRID_DENOM = 4294967296;

export type SharePlay = {
  rulesVersion: number;
  seed: number;
  /** プレイの長さ（tick）。再生はこの tick まで進める */
  endTick: number;
  inputs: LaunchInput[];
};

export type DecodeFailReason =
  | 'empty'
  | 'tooLong'
  | 'badCharacter'
  | 'truncated'
  | 'badVersion'
  | 'checksum'
  | 'badData';

export type DecodePlayResult = { ok: true; play: SharePlay } | { ok: false; reason: DecodeFailReason };

function fail(reason: DecodeFailReason): DecodePlayResult {
  return { ok: false, reason };
}

// ───────── 入力の分類 ─────────

/** rng() * Math.PI * 2 と同じ計算順で、格子上の角度を作る（ビット一致させるため順序を変えない）。 */
function gridAngle(k: number): number {
  return (k / GRID_DENOM) * Math.PI * 2;
}

/** 角度が 2π/2^32 の格子に乗っていればその番号、乗っていなければ null。往復で一致する物だけ認める。 */
function gridIndex(angle: number): number | null {
  if (!Number.isFinite(angle)) return null;
  const k = Math.round((angle / (Math.PI * 2)) * GRID_DENOM);
  if (k < 0 || k >= GRID_DENOM) return null;
  return gridAngle(k) === angle ? k : null;
}

/** 「押して離す」で出る速度（核へまっすぐ、速さ DROP_SPEED）とビット一致するか。値で見るので出自を問わない。 */
function isStraightDrop(input: LaunchInput): boolean {
  const a = input.originAngleRadians;
  return input.vx === -Math.cos(a) * DROP_SPEED && input.vy === -Math.sin(a) * DROP_SPEED;
}

// ───────── 公開関数 ─────────

export type EncodePlayArgs = {
  rulesVersion: number;
  seed: number;
  inputs: readonly LaunchInput[];
  /** 共有した時点の tick。省略すると最後の入力の tick（入力が無ければ 0） */
  endTick?: number;
};

/**
 * プレイを文字列にする。入力がおかしい（負の tick、時系列が逆、非有限な数、上限超過）ときは
 * 空文字列を返す（例外は投げない）。
 */
export function encodePlay(args: EncodePlayArgs): string {
  if (typeof args !== 'object' || args === null) return '';
  const { rulesVersion, seed, inputs } = args;
  if (!Array.isArray(inputs) || inputs.length > MAX_INPUTS) return '';
  // endTick の省略時は最後の入力の tick を使う。要素が型を越えた物なら NaN になり、後の整数チェックで弾く
  const last = inputs.length ? (inputs[inputs.length - 1] as LaunchInput | null | undefined) : undefined;
  const lastTick = typeof last === 'object' && last !== null ? last.tick : Number.NaN;
  const endTick = args.endTick ?? lastTick;
  if (!Number.isInteger(rulesVersion) || rulesVersion < 0 || rulesVersion > 255) return '';
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return '';
  if (!Number.isInteger(endTick) || endTick < 0 || endTick > MAX_TICKS) return '';

  const bytes: number[] = [SHARE_FORMAT_VERSION];
  writeVarint(bytes, rulesVersion);
  writeVarint(bytes, seed);
  writeVarint(bytes, endTick);
  writeVarint(bytes, inputs.length);

  let prevTick = 0;
  for (const input of inputs) {
    // 実行時には型を越えた物（null・数など）が紛れうるので、先に object かどうかで弾く
    if (typeof input !== 'object' || input === null) return '';
    const { tick, originAngleRadians: angle, vx, vy } = input;
    if (!Number.isInteger(tick) || tick < prevTick || tick > endTick) return '';
    if (!Number.isFinite(angle) || !Number.isFinite(vx) || !Number.isFinite(vy)) return '';
    const head = (tick - prevTick) * 4;
    prevTick = tick;
    if (isStraightDrop(input)) {
      const k = gridIndex(angle);
      if (k !== null) {
        writeVarint(bytes, head + TAG_DROP_GRID);
        writeU32(bytes, k);
      } else {
        writeVarint(bytes, head + TAG_DROP);
        writeF64(bytes, angle);
      }
    } else {
      writeVarint(bytes, head + TAG_RAW);
      writeF64(bytes, angle);
      writeF64(bytes, vx);
      writeF64(bytes, vy);
    }
  }

  const body = Uint8Array.from(bytes);
  const sum = fnv1a(body);
  const all = new Uint8Array(body.length + 4);
  all.set(body);
  all[body.length] = sum & 255;
  all[body.length + 1] = (sum >>> 8) & 255;
  all[body.length + 2] = (sum >>> 16) & 255;
  all[body.length + 3] = (sum >>> 24) & 255;
  const text = bytesToBase64Url(all);
  return text.length <= MAX_TEXT_LENGTH ? text : '';
}

/**
 * 文字列を読み戻す。どんな文字列が来ても例外を投げず、失敗は理由付きで返す。
 * 先に検査値を確かめてから読むので、壊れた文字列は読み途中で変な値を拾わない。
 */
export function decodePlay(text: string): DecodePlayResult {
  try {
    const t = typeof text === 'string' ? text.trim() : '';
    if (t.length === 0) return fail('empty');
    if (t.length > MAX_TEXT_LENGTH) return fail('tooLong');
    const bytes = base64UrlToBytes(t);
    if (bytes === null) return fail('badCharacter');
    if (bytes.length < 5) return fail('truncated');
    const body = bytes.subarray(0, bytes.length - 4);
    const sum =
      bytes[bytes.length - 4]! +
      bytes[bytes.length - 3]! * 256 +
      bytes[bytes.length - 2]! * 65536 +
      bytes[bytes.length - 1]! * 16777216;
    if (fnv1a(body) !== sum) return fail('checksum');
    if (body[0] !== SHARE_FORMAT_VERSION) return fail('badVersion');

    const pos = { i: 1 };
    const rulesVersion = readVarint(body, pos);
    const seed = readVarint(body, pos);
    const endTick = readVarint(body, pos);
    const count = readVarint(body, pos);
    if (rulesVersion === null || rulesVersion > 255) return fail('badData');
    if (seed === null || seed > 0xffffffff) return fail('badData');
    if (endTick === null || endTick > MAX_TICKS) return fail('badData');
    if (count === null || count > MAX_INPUTS) return fail('badData');

    const inputs: LaunchInput[] = [];
    let prevTick = 0;
    for (let n = 0; n < count; n++) {
      const head = readVarint(body, pos);
      if (head === null) return fail('truncated');
      const tag = head % 4;
      const tick = prevTick + (head - tag) / 4;
      if (tick > endTick) return fail('badData');
      let angle: number;
      let vx: number;
      let vy: number;
      if (tag === TAG_DROP_GRID) {
        const k = readU32(body, pos);
        if (k === null) return fail('truncated');
        angle = gridAngle(k);
        vx = -Math.cos(angle) * DROP_SPEED;
        vy = -Math.sin(angle) * DROP_SPEED;
      } else if (tag === TAG_DROP) {
        const a = readF64(body, pos);
        if (a === null) return fail('truncated');
        angle = a;
        vx = -Math.cos(angle) * DROP_SPEED;
        vy = -Math.sin(angle) * DROP_SPEED;
      } else if (tag === TAG_RAW) {
        const a = readF64(body, pos);
        const x = readF64(body, pos);
        const y = readF64(body, pos);
        if (a === null || x === null || y === null) return fail('truncated');
        angle = a;
        vx = x;
        vy = y;
      } else {
        return fail('badData');
      }
      if (!Number.isFinite(angle) || !Number.isFinite(vx) || !Number.isFinite(vy)) return fail('badData');
      inputs.push({ tick, originAngleRadians: angle, vx, vy });
      prevTick = tick;
    }
    if (pos.i !== body.length) return fail('badData');
    return { ok: true, play: { rulesVersion, seed, endTick, inputs } };
  } catch {
    return fail('badData');
  }
}
