// 「検査値が正しいのに中身がおかしい」文字列への耐性と、上限ぎりぎりの文字列の確かめ。
// 検査値を付け直した細工は、テスト内で同じ手順（FNV-1a）を自分で回して再現する。
// 正当なエンコーダでは作れない形（未知タグ・非有限な値・個数の不整合）だけを集めている。

import { describe, expect, it } from 'vitest';
import type { LaunchInput } from '../contracts/game';
import { DROP_SPEED } from '../game/constants';
import { decodePlay, encodePlay, SHARE_FORMAT_VERSION } from './codec';
import { base64UrlToBytes, bytesToBase64Url, fnv1a, writeF64, writeVarint } from './coding';

const GRID_DENOM = 4294967296;
/** codec.ts の MAX_TEXT_LENGTH と同じ（上限の境目テスト用）。 */
const MAX_TEXT_LENGTH = 262_144;

/** rng() * Math.PI * 2 と同じ計算順で、格子（2π/2^32）上の角度を作る。 */
function gridAngle(k: number): number {
  return (k / GRID_DENOM) * Math.PI * 2;
}

/** 「押して離す」で出る入力（dropAt と同じ式）。 */
function drop(tick: number, angle: number): LaunchInput {
  return { tick, originAngleRadians: angle, vx: -Math.cos(angle) * DROP_SPEED, vy: -Math.sin(angle) * DROP_SPEED };
}

/** 生の body に検査値（FNV-1a）を付けて文字列にする。codec.ts と同じ手順の、テスト用の手組みエンコーダ。 */
function pack(body: number[]): string {
  const all = new Uint8Array(body.length + 4);
  all.set(body);
  const sum = fnv1a(all.subarray(0, body.length));
  all[body.length] = sum & 255;
  all[body.length + 1] = (sum >>> 8) & 255;
  all[body.length + 2] = (sum >>> 16) & 255;
  all[body.length + 3] = (sum >>> 24) & 255;
  return bytesToBase64Url(all);
}

/** 正しい文字列の body を書き換え、検査値を付け直す（検査値をすり抜ける細工の再現）。 */
function forge(base: string, mutate: (body: number[]) => void): string {
  const bytes = base64UrlToBytes(base);
  if (bytes === null) throw new Error('base is not decodable');
  const body = [...bytes.subarray(0, bytes.length - 4)];
  mutate(body);
  return pack(body);
}

// 小さいサンプルのバイト配置（全部 1 バイトの varint で済む値を選んでいる）:
//   [0]=形式の版, [1]=rulesVersion, [2]=seed, [3]=endTick, [4]=個数, [5]=入力の頭, 以降=中身
const SAMPLE = encodePlay({ rulesVersion: 1, seed: 0, endTick: 100, inputs: [drop(0, gridAngle(5))] });

describe('decodePlay: 検査値を付け直した細工', () => {
  it('知らない入力タグは弾く', () => {
    const d = decodePlay(forge(SAMPLE, (b) => { b[5] = 3; })); // 入力の頭をタグ 3 に
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('badData');
  });

  it('入力の tick が終了を越える物は弾く', () => {
    // 入力の頭を「tick 差 101・タグ 0」= 404 の varint [0x94, 0x03] に差し替える → tick 101 > endTick 100
    const d = decodePlay(forge(SAMPLE, (b) => { b.splice(5, 1, 0x94, 0x03); }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('badData');
  });

  it('個数が実際より多い物は途中切れとして弾く', () => {
    const d = decodePlay(forge(SAMPLE, (b) => { b[4] = 2; })); // 個数を 1 → 2 に
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('truncated');
  });

  it('個数が実際より少ない物は読み切れず弾く', () => {
    const d = decodePlay(forge(SAMPLE, (b) => { b[4] = 0; })); // 個数を 1 → 0 に（入力のバイトが余る）
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('badData');
  });

  it('入力の値に NaN が紛れた物は弾く', () => {
    // 「投げる」入力の配置: [5]=頭（タグ 2）, [6..13]=角度, [14..21]=vx, [22..29]=vy
    const raw = encodePlay({
      rulesVersion: 1,
      seed: 0,
      endTick: 100,
      inputs: [{ tick: 0, originAngleRadians: 0.5, vx: 100, vy: -200 }],
    });
    // vx を f64 の NaN（下位 6 バイト 0 + 0xF8 0x7F のリトルエンディアン）に書き換える
    const d = decodePlay(forge(raw, (b) => { b.splice(14, 8, 0, 0, 0, 0, 0, 0, 0xf8, 0x7f); }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('badData');
  });

  it('最短でない varint を使った形は弾く（値が同じでも正規形でなければ駄目）', () => {
    // 個数 1 を冗長な [0x81,0x00] に書き換える → readVarint が弾く
    const d = decodePlay(forge(SAMPLE, (b) => { b.splice(4, 1, 0x81, 0x00); }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('badData');
    // 入力の頭（SAMPLE は tick 差 0・タグ 0 の [0]）を冗長な [0x80,0x00] に差し替える
    const head = decodePlay(forge(SAMPLE, (b) => { b.splice(5, 1, 0x80, 0x00); }));
    expect(head.ok).toBe(false);
    if (!head.ok) expect(head.reason).toBe('truncated');
  });

  it('ヘッダの上限を越える値は弾く（endTick 上限超過・seed が 2^32）', () => {
    // endTick 100 → 1,728,001（= 4 時間 + 1 tick）に差し替える: 1+60*128+105*16384
    const overEnd = decodePlay(forge(SAMPLE, (b) => { b.splice(3, 1, 0x81, 0xbc, 0x69); }));
    expect(overEnd.ok).toBe(false);
    if (!overEnd.ok) expect(overEnd.reason).toBe('badData');
    // seed 0 → 2^32 に差し替える: 16*128^4
    const bigSeed = decodePlay(forge(SAMPLE, (b) => { b.splice(2, 1, 0x80, 0x80, 0x80, 0x80, 0x10); }));
    expect(bigSeed.ok).toBe(false);
    if (!bigSeed.ok) expect(bigSeed.reason).toBe('badData');
  });

  it('大きい経路で入れた格子の入力は、読み戻すと小さい正規形に直る', () => {
    // 格子上の角度をあえて「角度だけ」形（8 バイト）で手組みする
    const body: number[] = [SHARE_FORMAT_VERSION, 1];
    writeVarint(body, 0); // seed
    writeVarint(body, 100); // endTick
    writeVarint(body, 1); // 個数
    writeVarint(body, 1); // 入力の頭 = tick 差 0 ×4 + タグ 1（角度だけ）
    writeF64(body, gridAngle(5));
    const text = pack(body);
    const d = decodePlay(text);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.play.inputs[0]?.originAngleRadians).toBe(gridAngle(5));
    // 同じプレイだが、正規の encoder は小さい「格子番号」形を出す（読み戻しで正準化される）
    const canonical = encodePlay({ rulesVersion: 1, seed: 0, endTick: 100, inputs: [drop(0, gridAngle(5))] });
    expect(text).not.toBe(canonical);
    expect(encodePlay({ ...d.play })).toBe(canonical);
  });
});

describe('上限の境目と速さ', () => {
  it('上限ちょうどの文字数は検査値で弾き、1 文字越えは tooLong で弾く（例外なし）', () => {
    const atCap = decodePlay('A'.repeat(MAX_TEXT_LENGTH)); // 全部 'A' = バイト 0 の並び → 検査値が合わない
    expect(atCap.ok).toBe(false);
    if (!atCap.ok) expect(atCap.reason).toBe('checksum');
    const over = decodePlay('A'.repeat(MAX_TEXT_LENGTH + 1));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toBe('tooLong');
  });

  it('上限近くの大きなプレイでも encode/decode は十分速い', () => {
    // 5 tick おきの入力 30,000 個 = 約 21 分ぶん。文字列は約 20 万文字で上限（262,144）の 8 割
    const inputs: LaunchInput[] = [];
    for (let i = 0; i < 30_000; i++) inputs.push(drop(i * 5, gridAngle((i * 65537) % GRID_DENOM)));
    const t0 = performance.now();
    const text = encodePlay({ rulesVersion: 1, seed: 1, endTick: 30_000 * 5 - 5, inputs });
    const t1 = performance.now();
    const d = decodePlay(text);
    const t2 = performance.now();
    console.info(
      `[share] 上限近く: inputs=${inputs.length} 文字数=${text.length} ` +
        `encode=${(t1 - t0).toFixed(1)}ms decode=${(t2 - t1).toFixed(1)}ms`,
    );
    expect(text.length).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.play.inputs).toHaveLength(inputs.length);
    // 通常は数十 ms で終わる。極端に遅い検査環境でも落ちないよう上限は緩く
    expect(t2 - t0).toBeLessThan(30_000);
  });
});
