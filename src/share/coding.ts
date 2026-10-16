// 文字列化に使う低レベルの道具。codec.ts から使う。単体でも確かめられるよう分けてある。
// - base64url（padding なし。URL に入れても壊れない文字だけを使う）
// - LEB128 の可変長整数
// - u32le / f64le の固定長
// - FNV-1a 32bit（壊れを見つけるための短い検査値）

// ───────── base64url ─────────

/** base64url に使う 64 文字（この順が値になる）。 */
export const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const B64_LOOKUP: readonly number[] = (() => {
  const table = new Array<number>(128).fill(-1);
  for (let i = 0; i < B64_CHARS.length; i++) table[B64_CHARS.charCodeAt(i)] = i;
  return table;
})();

export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  const n = bytes.length;
  for (let i = 0; i + 2 < n; i += 3) {
    const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64_CHARS[v >>> 18]! + B64_CHARS[(v >>> 12) & 63]! + B64_CHARS[(v >>> 6) & 63]! + B64_CHARS[v & 63]!;
  }
  const rem = n % 3;
  if (rem === 1) {
    const v = bytes[n - 1]! << 16;
    out += B64_CHARS[v >>> 18]! + B64_CHARS[(v >>> 12) & 63]!;
  } else if (rem === 2) {
    const v = (bytes[n - 2]! << 16) | (bytes[n - 1]! << 8);
    out += B64_CHARS[v >>> 18]! + B64_CHARS[(v >>> 12) & 63]! + B64_CHARS[(v >>> 6) & 63]!;
  }
  return out;
}

function charValue(text: string, i: number): number {
  const code = text.charCodeAt(i);
  return code < 128 ? (B64_LOOKUP[code] ?? -1) : -1;
}

/**
 * 読めたらバイト列、文字がおかしければ null。
 * 余りビットが 0 でない詰め方（正規の encoder が出さない形）も弾く。
 * こうすると、末尾側の 1 文字を変えただけの壊れも見逃さない。
 */
export function base64UrlToBytes(text: string): Uint8Array | null {
  const len = text.length;
  if (len % 4 === 1) return null; // base64 では出ない長さ
  const out = new Uint8Array(Math.floor((len * 6) / 8));
  let o = 0;
  let i = 0;
  for (; i + 4 <= len; i += 4) {
    const c0 = charValue(text, i);
    const c1 = charValue(text, i + 1);
    const c2 = charValue(text, i + 2);
    const c3 = charValue(text, i + 3);
    if ((c0 | c1 | c2 | c3) < 0) return null;
    const v = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    out[o++] = v >>> 16;
    out[o++] = (v >>> 8) & 255;
    out[o++] = v & 255;
  }
  const rem = len - i;
  if (rem === 2) {
    const c0 = charValue(text, i);
    const c1 = charValue(text, i + 1);
    if ((c0 | c1) < 0 || (c1 & 15) !== 0) return null;
    out[o++] = (c0 << 2) | (c1 >>> 4);
  } else if (rem === 3) {
    const c0 = charValue(text, i);
    const c1 = charValue(text, i + 1);
    const c2 = charValue(text, i + 2);
    if ((c0 | c1 | c2) < 0 || (c2 & 3) !== 0) return null;
    out[o++] = (c0 << 2) | (c1 >>> 4);
    out[o++] = ((c1 & 15) << 4) | (c2 >>> 2);
  }
  return out;
}

// ───────── 可変長整数・固定長の数 ─────────

/** 非負整数を可変長で書く（LEB128）。Math.floor ベースなので 2^53 まで安全。 */
export function writeVarint(out: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

/**
 * 読めたら値、だめなら null。pos は読んだ分だけ進む。10 バイトで打ち切る（2^53 を越える物は読まない）。
 * 終端バイトが 0 の 2 バイト以上の列（[0x80,0x00] など）は最短でない形なので弾く。
 * 正規の encoder は最短形しか出さない。正規形だけを受理すると、別の文字列が同じ値に化けるのを防げる。
 */
export function readVarint(bytes: Uint8Array, pos: { i: number }): number | null {
  let v = 0;
  let mul = 1;
  for (let n = 0; n < 10; n++) {
    if (pos.i >= bytes.length) return null;
    const b = bytes[pos.i++]!;
    v += (b & 0x7f) * mul;
    if (v > Number.MAX_SAFE_INTEGER) return null;
    if ((b & 0x80) === 0) return n > 0 && b === 0 ? null : v;
    mul *= 0x80;
  }
  return null;
}

export function writeU32(out: number[], value: number): void {
  out.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
}

export function readU32(bytes: Uint8Array, pos: { i: number }): number | null {
  if (pos.i + 4 > bytes.length) return null;
  const v = bytes[pos.i]! + bytes[pos.i + 1]! * 256 + bytes[pos.i + 2]! * 65536 + bytes[pos.i + 3]! * 16777216;
  pos.i += 4;
  return v;
}

const f64buf = new DataView(new ArrayBuffer(8));

/** f64 をビット単位で書く（-0 と NaN も含めて往復する）。 */
export function writeF64(out: number[], value: number): void {
  f64buf.setFloat64(0, value, true);
  for (let i = 0; i < 8; i++) out.push(f64buf.getUint8(i));
}

export function readF64(bytes: Uint8Array, pos: { i: number }): number | null {
  if (pos.i + 8 > bytes.length) return null;
  for (let i = 0; i < 8; i++) f64buf.setUint8(i, bytes[pos.i + i]!);
  pos.i += 8;
  return f64buf.getFloat64(0, true);
}

// ───────── 検査値（FNV-1a 32bit）─────────

/** 簡単な hash。同じ列なら必ず同じ値。1 バイトでも違えばほぼ必ず違う値になる。 */
export function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
