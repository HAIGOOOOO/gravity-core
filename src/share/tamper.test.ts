// 「検査値が正しいのに中身がおかしい」文字列への耐性と、上限ぎりぎりの文字列の確かめ。
// 検査値を付け直した細工は、テスト内で同じ手順（FNV-1a）を自分で回して再現する。
// 正当なエンコーダでは作れない形（未知タグ・非有限な値・個数の不整合）だけを集めている。

import { describe, expect, it } from 'vitest';
import type { LaunchInput } from '../contracts/game';
import { DROP_SPEED } from '../game/constants';
import { createRng } from '../game/rng';
import { decodePlay, encodePlay, MAX_TEXT_LENGTH, SHARE_FORMAT_VERSION } from './codec';
import { base64UrlToBytes, bytesToBase64Url, fnv1a, writeF64, writeVarint } from './coding';

const GRID_DENOM = 4294967296;

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

  it('ヘッダの上限を越える値は弾く（rulesVersion 256・個数が上限超過）', () => {
    // rulesVersion 1 → 256（varint: 256 = 0 + 2×128 → [0x80,0x02]）
    const rv = decodePlay(forge(SAMPLE, (b) => { b.splice(1, 1, 0x80, 0x02); }));
    expect(rv.ok).toBe(false);
    if (!rv.ok) expect(rv.reason).toBe('badData');
    // 個数 1 → 100,001（varint: 33 + 13×128 + 6×16384 → [0xa1,0x8d,0x06]）
    const many = decodePlay(forge(SAMPLE, (b) => { b.splice(4, 1, 0xa1, 0x8d, 0x06); }));
    expect(many.ok).toBe(false);
    if (!many.ok) expect(many.reason).toBe('badData');
  });

  it('入力の中身が途中で切れている物は truncated で弾く', () => {
    // タグ 0（格子）の u32 が無い形: SAMPLE の本体を入力の頭までで切る
    const cutU32 = decodePlay(forge(SAMPLE, (b) => { b.length = 6; }));
    expect(cutU32.ok).toBe(false);
    if (!cutU32.ok) expect(cutU32.reason).toBe('truncated');
    // タグ 1（角度だけ）の f64 が半分しか無い形を手組みする
    const body: number[] = [SHARE_FORMAT_VERSION, 1];
    writeVarint(body, 0); // seed
    writeVarint(body, 100); // endTick
    writeVarint(body, 1); // 個数
    writeVarint(body, 1); // 入力の頭 = tick 差 0 ×4 + タグ 1
    body.push(0, 0, 0, 0); // f64 は 8 バイト必要なのに 4 バイトだけ
    const cutF64 = decodePlay(pack(body));
    expect(cutF64.ok).toBe(false);
    if (!cutF64.ok) expect(cutF64.reason).toBe('truncated');
  });

  it('入力の角度に非有限な値が紛れた物は弾く（「角度だけ」経路も含む）', () => {
    // タグ 1 の角度が NaN → そこから計算する vx/vy も NaN になるので弾く
    const dropNaN: number[] = [SHARE_FORMAT_VERSION, 1];
    writeVarint(dropNaN, 0);
    writeVarint(dropNaN, 100);
    writeVarint(dropNaN, 1);
    writeVarint(dropNaN, 1); // タグ 1
    writeF64(dropNaN, Number.NaN);
    const d1 = decodePlay(pack(dropNaN));
    expect(d1.ok).toBe(false);
    if (!d1.ok) expect(d1.reason).toBe('badData');
    // タグ 2（投げる）の vy が Infinity（角度・vx は有限）
    const rawInf: number[] = [SHARE_FORMAT_VERSION, 1];
    writeVarint(rawInf, 0);
    writeVarint(rawInf, 100);
    writeVarint(rawInf, 1);
    writeVarint(rawInf, 2); // タグ 2
    writeF64(rawInf, 0.5);
    writeF64(rawInf, 100);
    writeF64(rawInf, Infinity);
    const d2 = decodePlay(pack(rawInf));
    expect(d2.ok).toBe(false);
    if (!d2.ok) expect(d2.reason).toBe('badData');
  });

  it('ヘッダの最小（5 バイト）に満たない本体は truncated で弾く', () => {
    // 検査値は正しいが本体が版バイト 1 つだけの形。読み始める以前に切れている
    const d = decodePlay(pack([SHARE_FORMAT_VERSION]));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('truncated');
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

  it('バイトを変えて検査値を付け直した文字列は、読めた場合も必ず正準形に直せる', () => {
    // 「1 文字変えると弾く」のは検査値の手前の話。ここでは検査値を付け直すので、
    // 正当だが中身の違う文字列が大量にできる。読み取れた物は例外なく
    // 「もう一度文字列にでき、それを読み戻すと同じプレイになる」（= 正準形が固定点）
    // ことを確かめる。decode の出力は必ず encode の合法入力、の裏付け。
    const rich = encodePlay({
      rulesVersion: 2,
      seed: 424242,
      endTick: 5000,
      inputs: [
        drop(0, gridAngle(9)),
        drop(120, 1.25),
        { tick: 240, originAngleRadians: 0.7, vx: 300, vy: -400 },
      ],
    });
    const base = base64UrlToBytes(rich);
    if (base === null) throw new Error('unreachable');
    const bodyLen = base.length - 4;
    const rng = createRng(0x5eed);
    let decodable = 0;
    for (let i = 0; i < 500; i++) {
      const pos = Math.floor(rng() * bodyLen);
      const value = Math.floor(rng() * 256);
      const d = decodePlay(forge(rich, (b) => { b[pos] = value; }));
      if (!d.ok) continue;
      decodable++;
      // 読めた以上、decode の出力は encode の入力として合法でなければならない
      const re = encodePlay({ ...d.play });
      expect(re).not.toBe('');
      const d2 = decodePlay(re);
      expect(d2.ok).toBe(true);
      if (!d2.ok) continue;
      // 正準形に揃ったあとは値が揺れない（読み戻し → 文字列化 → 読み戻し でビット一致）
      expect(d2.play.rulesVersion).toBe(d.play.rulesVersion);
      expect(d2.play.seed).toBe(d.play.seed);
      expect(d2.play.endTick).toBe(d.play.endTick);
      expect(d2.play.inputs).toHaveLength(d.play.inputs.length);
      d.play.inputs.forEach((w, j) => {
        const a = d2.play.inputs[j]!;
        expect(Object.is(a.tick, w.tick)).toBe(true);
        expect(Object.is(a.originAngleRadians, w.originAngleRadians)).toBe(true);
        expect(Object.is(a.vx, w.vx)).toBe(true);
        expect(Object.is(a.vy, w.vy)).toBe(true);
      });
      expect(encodePlay({ ...d2.play })).toBe(re);
    }
    expect(decodable).toBeGreaterThan(50); // 値だけを変えた変異は大半が読めるはず
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
