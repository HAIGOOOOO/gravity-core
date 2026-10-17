import { describe, expect, it } from 'vitest';
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

function encodeVarint(v: number): Uint8Array {
  const out: number[] = [];
  writeVarint(out, v);
  return Uint8Array.from(out);
}

describe('writeVarint / readVarint', () => {
  it('小さい数は 1 バイト、127 を越えると伸びる', () => {
    expect([...encodeVarint(0)]).toEqual([0]);
    expect([...encodeVarint(127)]).toEqual([127]);
    expect([...encodeVarint(128)]).toEqual([128, 1]);
    expect([...encodeVarint(300)]).toEqual([172, 2]); // 300 = 44 + 2*128
  });

  it('境界を含む値が往復する', () => {
    const values = [0, 1, 127, 128, 16383, 16384, 0xffffffff, Number.MAX_SAFE_INTEGER];
    for (const v of values) {
      const bytes = encodeVarint(v);
      const pos = { i: 0 };
      expect(readVarint(bytes, pos)).toBe(v);
      expect(pos.i).toBe(bytes.length); // 全部ちょうど読み切る
    }
  });

  it('途中で切れた列・続きすぎる列・大きすぎる値は null', () => {
    expect(readVarint(Uint8Array.from([0x80]), { i: 0 })).toBe(null);
    // 11 バイト全部に続きビット → 10 バイトで打ち切る
    expect(readVarint(new Uint8Array(11).fill(0x80), { i: 0 })).toBe(null);
    // 56 bit ぶんの値 = MAX_SAFE_INTEGER を越える
    expect(readVarint(Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]), { i: 0 })).toBe(null);
  });

  it('最短でない形（終端が 0 の 2 バイト以上の列）は弾く', () => {
    // [0x80,0x00] は値 0 を冗長に書いた形。正規の encoder は出さない
    expect(readVarint(Uint8Array.from([0x80, 0x00]), { i: 0 })).toBe(null);
    expect(readVarint(Uint8Array.from([0x81, 0x80, 0x00]), { i: 0 })).toBe(null);
    // 途中の 0x80（値の一部として 0 の桁）があっても、終端が 0 でなければ最短形として読める
    expect(readVarint(Uint8Array.from([0x00]), { i: 0 })).toBe(0);
    expect(readVarint(Uint8Array.from([0x80, 0x01]), { i: 0 })).toBe(128);
    expect(readVarint(Uint8Array.from([0x80, 0x80, 0x01]), { i: 0 })).toBe(16384);
  });

  it('失敗時も pos は読んだ分だけ進んでいる（呼び側は続きを読まない前提）', () => {
    const pos = { i: 0 };
    expect(readVarint(Uint8Array.from([5, 0x80]), pos)).toBe(5);
    expect(pos.i).toBe(1);
  });
});

describe('writeU32 / readU32', () => {
  it('往復する', () => {
    for (const v of [0, 1, 255, 256, 0xffffffff]) {
      const out: number[] = [];
      writeU32(out, v);
      const pos = { i: 0 };
      expect(readU32(Uint8Array.from(out), pos)).toBe(v);
      expect(pos.i).toBe(4);
    }
  });

  it('足りなければ null', () => {
    expect(readU32(Uint8Array.from([1, 2, 3]), { i: 0 })).toBe(null);
  });
});

describe('writeF64 / readF64', () => {
  it('ビット単位で往復する（-0 と NaN を含む）', () => {
    const values = [0, -0, 1.5, -273.15, Math.PI, Number.MAX_VALUE, 5e-324, NaN, Infinity, -Infinity];
    for (const v of values) {
      const out: number[] = [];
      writeF64(out, v);
      const pos = { i: 0 };
      const r = readF64(Uint8Array.from(out), pos);
      expect(pos.i).toBe(8);
      expect(Object.is(r, v)).toBe(true);
    }
  });

  it('足りなければ null', () => {
    expect(readF64(Uint8Array.from([1, 2, 3]), { i: 0 })).toBe(null);
  });
});

describe('bytesToBase64Url / base64UrlToBytes', () => {
  it('長さ 0〜8 のバイト列が往復する', () => {
    for (let n = 0; n <= 8; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => i * 37 + 11);
      const text = bytesToBase64Url(bytes);
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      const back = base64UrlToBytes(text);
      expect(back).not.toBe(null);
      expect([...back!]).toEqual([...bytes]);
    }
  });

  it('全 256 値の往復（文字の偏りが無いことの確かめ）', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const text = bytesToBase64Url(bytes);
    expect([...base64UrlToBytes(text)!]).toEqual([...bytes]);
  });

  it('出力は URL エンコードで変化しない（そのままクエリに載る文字だけ）', () => {
    // 全 256 バイトを通した文字列 = 64 文字全部を含む。encodeURIComponent が恒等なら URL 安全
    const all = bytesToBase64Url(Uint8Array.from({ length: 256 }, (_, i) => i));
    expect(encodeURIComponent(all)).toBe(all);
  });

  it('表に無い文字・base64 で出ない長さ・余りビットの立った詰めは null', () => {
    expect(base64UrlToBytes('A')).toBe(null); // 長さ %4==1 は出ない
    expect(base64UrlToBytes('AB!D')).toBe(null); // 表に無い文字
    expect(base64UrlToBytes('あいうえ')).toBe(null); // ASCII 外
    // 'h' は値 33。2 文字形なら下位 4 bit が余りビット → 33&15=1 で非正規
    expect(base64UrlToBytes('Ah')).toBe(null);
    // 3 文字形なら下位 2 bit が余りビット → 33&3=1 で非正規
    expect(base64UrlToBytes('ABh')).toBe(null);
    // 正規の詰め（余りビット 0）は読める
    expect(base64UrlToBytes('AQ')).not.toBe(null); // 'Q'=16、16&15=0
    expect(base64UrlToBytes('AA')).not.toBe(null);
  });
});

describe('fnv1a', () => {
  it('同じ列は同じ値、空列は offset basis、1 バイト違いは違う値', () => {
    expect(fnv1a(new Uint8Array(0))).toBe(0x811c9dc5);
    const a = Uint8Array.from([1, 2, 3, 4, 5]);
    const b = Uint8Array.from([1, 2, 3, 4, 6]);
    expect(fnv1a(a)).toBe(fnv1a(Uint8Array.from(a)));
    expect(fnv1a(a)).not.toBe(fnv1a(b));
  });

  it('最後の 1 バイトだけ違う列は全部違う値になる（FNV-1a は (h^v)*p で末尾 1 バイトについて全単射）', () => {
    const base = Uint8Array.from([9, 8, 7]);
    let same = 0;
    for (let v = 0; v < 256; v++) {
      if (fnv1a(Uint8Array.from([...base, v])) === fnv1a(Uint8Array.from([...base, 0]))) same++;
    }
    expect(same).toBe(1); // v=0 の自分だけ
  });
});
