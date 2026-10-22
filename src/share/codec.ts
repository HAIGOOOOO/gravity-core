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
//     種別 0: u32le の k → 角度 = (k / 2^32) * π * 2。速度は「まっすぐ落とす」を整数に丸めて計算し直す
//             （シミュレーションが丸めた「押して離す」はほぼ全部これ。形式の版 2 から）
//     種別 1: f64 の角度。速度は同上で計算し直す
//     種別 2: f64 の角度・vx・vy をそのまま
//     種別 3: u32le の k（角度は種別 0 と同じ）+ zigzag varint の vx・vy（整数）。
//             シミュレーションが丸めた射出（src/game/predictor.ts の quantizeLaunch）は全部これに乗る（1 投 7〜9 バイト）
//   崩壊がある時だけ: [varint]件数、各[varint]射出の添字 + [varint]射出からのtick差（形式3から）
//   [u32le]  ここまで全部の FNV-1a（壊れを見つける検査値）
// 文字は URL に入れても壊れない base64url（padding なし）。
//
// 値の入れ方について: この物理は小さなズレが接触判定を経て増幅しうるので、
// 値を丸めて小さくする代わりに「同じ計算で出せる値は計算し直す」方式にした。
// 「まっすぐ落とす」（速度 -cos(角度)*DROP_SPEED, -sin(角度)*DROP_SPEED）は角度だけで復元できる。
// その中でも角度が 2π/2^32 の格子に乗る入力（createRng 由来 = 自動プレイ全部）は 4 バイト。
// 格子に乗らない「まっすぐ落とす」は 8 バイト、それ以外（投げる）は 24 バイトで
// 値のビットをそのまま入れる。どの経路でも誤差は 0 で、再生は元のプレイと完全に一致する。

import type { LaunchInput, SimulationPort } from '../contracts/game';
import { DROP_SPEED, TICK_HZ } from '../game/constants';
import { expandLaunchInputs } from '../shared/input-timeline';
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
export const SHARE_FORMAT_VERSION = 3;
/** いまのルールの版。RULES.md のルールが変わったら +1 する（リーダー管理）。 */
export const SHARE_RULES_VERSION = 7; // 7: 盤面全体の流れ（2026-10-22）

/**
 * 文字列の長さの上限。4 時間ぶんの「まっすぐ落とし」連打（約 2.9 万入力）でも十分入る大きさ。
 * 実際の入力数の上限はこちらが先に効く（全部「投げる」だと約 8,000 入力で頭打ち）。
 * 貼り付け口（extractShareText）も同じ上限で候補を絞るので、export してある。
 */
export const MAX_TEXT_LENGTH = 262_144;
/** 入力の数の上限。文字列の上限より先に効くことはほぼないが、読む側の安全として置く。
 *  テストが上限値と連動して境目を確かめられるよう export（./index の公開面には出さない）。 */
export const MAX_INPUTS = 100_000;
/** プレイの長さの上限 = 4 時間（tick）。これを越える記録は壊れた物とみなす。同上の理由で export。 */
export const MAX_TICKS = TICK_HZ * 60 * 60 * 4;

const TAG_DROP_GRID = 0;
const TAG_DROP = 1;
const TAG_RAW = 2;
const TAG_GRID_INT = 3;
/** 種別 3 で持てる速度の大きさ。ゲームの速さの上限よりずっと大きく、zigzag が安全に計算できる範囲 */
const INT_LIMIT = 1_000_000;
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
  // -0 は格子番号に潰せない: writeU32 では -0 が 0 として書かれ、読み戻しでは +0 になる。
  // 角度が -0→+0 に変わると vy の 0 の符号（+0/-0）が元とずれるので、f64 の経路へ回す
  if (Object.is(angle, -0)) return null;
  const k = Math.round((angle / (Math.PI * 2)) * GRID_DENOM);
  if (k < 0 || k >= GRID_DENOM) return null;
  return gridAngle(k) === angle ? k : null;
}

/** 丸めた「まっすぐ落とす」の速度（シミュレーションの quantizeLaunch と同じ丸め）。 */
function roundedDrop(angle: number): { vx: number; vy: number } {
  return { vx: Math.round(-Math.cos(angle) * DROP_SPEED) + 0, vy: Math.round(-Math.sin(angle) * DROP_SPEED) + 0 };
}

/** 格子の上の角度で、速度が丸めた「まっすぐ落とす」とビット一致するか。一致すれば格子の番号、しなければ null。 */
function roundedDropIndex(input: LaunchInput): number | null {
  const k = gridIndex(input.originAngleRadians);
  if (k === null) return null;
  const v = roundedDrop(input.originAngleRadians);
  return Object.is(input.vx, v.vx) && Object.is(input.vy, v.vy) ? k : null;
}

/** 「押して離す」で出る速度（核へまっすぐ、速さ DROP_SPEED）とビット一致するか。値で見るので出自を問わない。 */
function isStraightDrop(input: LaunchInput): boolean {
  const a = input.originAngleRadians;
  // Object.is で比べる: === は +0 と -0 を区別しないため、式が出す 0 の符号と逆の速度を持つ入力を
  // 「まっすぐ落とし」と誤認し、読み戻しで vy の 0 の符号がずれてしまう（角度 ±0 のときだけ起きる）
  return (
    Object.is(input.vx, -Math.cos(a) * DROP_SPEED) &&
    Object.is(input.vy, -Math.sin(a) * DROP_SPEED)
  );
}

/** 整数で、-0 でなく、範囲内か（種別 3 で誤差 0 で持てるか） */
function isPlainInt(v: number): boolean {
  return Number.isInteger(v) && !Object.is(v, -0) && Math.abs(v) <= INT_LIMIT;
}

function zigzag(v: number): number {
  return v >= 0 ? v * 2 : -v * 2 - 1;
}

function unzigzag(z: number): number {
  return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
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
  try {
    return encodeInner(args);
  } catch {
    // 要素や引数の getter が投げる・Proxy など、型を越えた物が来ても外へ例外は出さない
    return '';
  }
}

/** encodePlay の本体。中では何が投げられてもよい（呼び出し側で受ける）。 */
function encodeInner(args: EncodePlayArgs): string {
  if (typeof args !== 'object' || args === null) return '';
  const { rulesVersion, seed, inputs } = args;
  if (!Array.isArray(inputs) || inputs.length > MAX_INPUTS) return '';
  // endTick の省略時は最後の入力の tick を使う（入力が無ければ doc どおり 0）。
  // 最後の要素が型を越えた物（null・数など）なら NaN になり、後の整数チェックで弾く
  const last = inputs.length ? (inputs[inputs.length - 1] as LaunchInput | null | undefined) : undefined;
  const lastTick = inputs.length === 0 ? 0 : typeof last === 'object' && last !== null ? Math.max(last.tick, last.collapseTick ?? last.tick) : Number.NaN;
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
    const dropK = roundedDropIndex(input);
    if (dropK !== null) {
      writeVarint(bytes, head + TAG_DROP_GRID);
      writeU32(bytes, dropK);
    } else if (isStraightDrop(input)) {
      writeVarint(bytes, head + TAG_DROP);
      writeF64(bytes, angle);
    } else if (gridIndex(angle) !== null && isPlainInt(vx) && isPlainInt(vy)) {
      writeVarint(bytes, head + TAG_GRID_INT);
      writeU32(bytes, gridIndex(angle)!);
      writeVarint(bytes, zigzag(vx));
      writeVarint(bytes, zigzag(vy));
    } else {
      writeVarint(bytes, head + TAG_RAW);
      writeF64(bytes, angle);
      writeF64(bytes, vx);
      writeF64(bytes, vy);
    }
  }

  if (!expandLaunchInputs(inputs, endTick)) return '';
  // 形式3: 崩壊を使った射出だけ、添字と射出からのtick差を末尾へ足す。
  const collapses = inputs.flatMap((input, index) => input.collapseTick === undefined ? [] : [{ index, delay: input.collapseTick - input.tick }]);
  if (collapses.length > 0) {
    writeVarint(bytes, collapses.length);
    for (const action of collapses) { writeVarint(bytes, action.index); writeVarint(bytes, action.delay); }
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
 * プレイ中（または終了した）シミュレーションから共有文字列を作る。
 * endTick にスナップショットの tick を必ず付ける。encodePlay で endTick を省略すると
 * 「最後の入力の tick」になり、共有した時点より短いプレイとして再生されてしまうので、
 * プレイの共有にはこちらを使う。ルールの版はこの実装の SHARE_RULES_VERSION。
 * 契約外の物（getter が投げる、おかしい値を返す sim もどき）が来ても空文字列を返す。
 */
export function encodeSimulation(sim: SimulationPort): string {
  try {
    const snap = sim.getSnapshot();
    return encodePlay({
      rulesVersion: SHARE_RULES_VERSION,
      seed: snap.seed,
      inputs: sim.getInputLog(),
      endTick: snap.tick,
    });
  } catch {
    return '';
  }
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
    // ヘッダ（版 + 4 つの varint）は最小でも 5 バイト。それ未満は中身を読む以前に切れている
    if (body.length < 5) return fail('truncated');
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
        ({ vx, vy } = roundedDrop(angle));
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
        const k = readU32(body, pos);
        const zx = readVarint(body, pos);
        const zy = readVarint(body, pos);
        if (k === null || zx === null || zy === null) return fail('truncated');
        if (zx > INT_LIMIT * 2 || zy > INT_LIMIT * 2) return fail('badData');
        angle = gridAngle(k);
        vx = unzigzag(zx);
        vy = unzigzag(zy);
      }
      if (!Number.isFinite(angle) || !Number.isFinite(vx) || !Number.isFinite(vy)) return fail('badData');
      inputs.push({ tick, originAngleRadians: angle, vx, vy });
      prevTick = tick;
    }
    if (pos.i < body.length) {
      const collapses = readVarint(body, pos);
      if (collapses === null || collapses === 0 || collapses > inputs.length) return fail('badData');
      let previous = -1;
      for (let n = 0; n < collapses; n++) {
        const index = readVarint(body, pos), delay = readVarint(body, pos);
        if (index === null || delay === null || index <= previous || index >= inputs.length) return fail('badData');
        const input = inputs[index]!;
        inputs[index] = { ...input, collapseTick: input.tick + delay }; previous = index;
      }
    }
    if (pos.i !== body.length || !expandLaunchInputs(inputs, endTick)) return fail('badData');
    return { ok: true, play: { rulesVersion, seed, endTick, inputs } };
  } catch {
    return fail('badData');
  }
}
