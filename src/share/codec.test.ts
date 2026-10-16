import { describe, expect, it } from 'vitest';
import type { LaunchInput } from '../contracts/game';
import { DROP_SPEED, TICK_HZ } from '../game/constants';
import { createRng } from '../game/rng';
import { decodePlay, encodePlay, SHARE_RULES_VERSION, type EncodePlayArgs } from './codec';
import { base64UrlToBytes, bytesToBase64Url, fnv1a } from './coding';

const GRID_DENOM = 4294967296;
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** codec.ts の上限と同じ（= 4 時間）。プレイ長の上限の境界テスト用。 */
const MAX_TICKS = TICK_HZ * 60 * 60 * 4;

/** rng() * Math.PI * 2 と同じ計算順で、格子（2π/2^32）上の角度を作る。 */
function gridAngle(k: number): number {
  return (k / GRID_DENOM) * Math.PI * 2;
}

/** 「押して離す」で出る入力（dropAt と同じ式）。 */
function drop(tick: number, angle: number): LaunchInput {
  return { tick, originAngleRadians: angle, vx: -Math.cos(angle) * DROP_SPEED, vy: -Math.sin(angle) * DROP_SPEED };
}

/** 入力をビット単位で比べる（-0 と +0、数のわずかな差も逃さない）。 */
function expectSameInputs(actual: readonly LaunchInput[], want: readonly LaunchInput[]): void {
  expect(actual).toHaveLength(want.length);
  want.forEach((w, i) => {
    const a = actual[i]!;
    expect(Object.is(a.tick, w.tick)).toBe(true);
    expect(Object.is(a.originAngleRadians, w.originAngleRadians)).toBe(true);
    expect(Object.is(a.vx, w.vx)).toBe(true);
    expect(Object.is(a.vy, w.vy)).toBe(true);
  });
}

describe('encodePlay / decodePlay', () => {
  it('混ざった入力を往復しても全値が一致する（格子・角度だけ・生の値）', () => {
    const inputs: LaunchInput[] = [
      drop(0, gridAngle(1234567890)), // 格子上の「まっすぐ落とし」
      drop(110, gridAngle(987654321)),
      drop(220, 2.468), // 格子に乗らない「まっすぐ落とし」
      { tick: 220, originAngleRadians: -0.7, vx: 412.3, vy: -89.7 }, // 投げる（同じ tick も可）
      { tick: 400, originAngleRadians: 1, vx: -300, vy: -520 },
    ];
    const text = encodePlay({ rulesVersion: SHARE_RULES_VERSION, seed: 42, endTick: 7200, inputs });
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    const d = decodePlay(text);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.play.rulesVersion).toBe(SHARE_RULES_VERSION);
    expect(d.play.seed).toBe(42);
    expect(d.play.endTick).toBe(7200);
    expectSameInputs(d.play.inputs, inputs);
  });

  it('格子の端・格子に乗らない向き・負の角度も往復する', () => {
    const inputs: LaunchInput[] = [
      drop(0, gridAngle(0)), // 格子の先端（角度 0）
      drop(10, gridAngle(GRID_DENOM - 1)), // 格子の終端
      drop(20, -0.7), // 負の角度（格子の外）
      drop(30, Math.PI * 2), // ちょうど一周（格子の外）
      drop(40, Math.PI * 2 * 1.5), // 一周超（格子の外）
      drop(50, 1e-12), // ほぼ 0（格子の外）
    ];
    const text = encodePlay({ rulesVersion: 1, seed: 1, endTick: 100, inputs });
    const d = decodePlay(text);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expectSameInputs(d.play.inputs, inputs);
  });

  it('境界の値を往復する（seed 最大・rulesVersion 両端・endTick 上限）', () => {
    const atMax = MAX_TICKS;
    const text = encodePlay({
      rulesVersion: 255,
      seed: 0xffffffff,
      endTick: atMax,
      inputs: [drop(0, 0.25), drop(atMax, 1.25)], // 最初と最後の tick ちょうど
    });
    const d = decodePlay(text);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.play.rulesVersion).toBe(255);
    expect(d.play.seed).toBe(0xffffffff);
    expect(d.play.endTick).toBe(atMax);
    expectSameInputs(d.play.inputs, [drop(0, 0.25), drop(atMax, 1.25)]);

    const zero = decodePlay(encodePlay({ rulesVersion: 0, seed: 0, inputs: [], endTick: 0 }));
    expect(zero.ok).toBe(true);
    if (zero.ok) {
      expect(zero.play.rulesVersion).toBe(0);
      expect(zero.play.endTick).toBe(0);
    }
  });

  it('読み戻した物をもう一度文字列にすると同じ文字列になる（正準形）', () => {
    const inputs: LaunchInput[] = [
      drop(0, gridAngle(99)),
      drop(60, 0.123456), // 格子に乗らない「まっすぐ落とし」
      { tick: 60, originAngleRadians: 2.9, vx: -100, vy: -400 }, // 投げる
    ];
    const text = encodePlay({ rulesVersion: 3, seed: 77, endTick: 999, inputs });
    const d = decodePlay(text);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const again = encodePlay({
      rulesVersion: d.play.rulesVersion,
      seed: d.play.seed,
      endTick: d.play.endTick,
      inputs: d.play.inputs,
    });
    expect(again).toBe(text);
  });

  it('読み戻せた物は必ずもう一度文字列にできる（decode の出力は encode の入力として合法）', () => {
    // 検査値をすり抜ける in vitro の文字列は作れないので、往復の組み合わせで確かめる
    const rng = createRng(555);
    for (let i = 0; i < 50; i++) {
      const seed = Math.floor(rng() * 0xffffffff);
      const count = Math.floor(rng() * 20);
      const inputs: LaunchInput[] = [];
      let tick = 0;
      for (let j = 0; j < count; j++) {
        tick += Math.floor(rng() * 600);
        const angle = gridAngle(Math.floor(rng() * GRID_DENOM));
        inputs.push(drop(tick, angle));
      }
      const text = encodePlay({ rulesVersion: 1, seed, endTick: tick + 100, inputs });
      const d = decodePlay(text);
      expect(d.ok).toBe(true);
      if (!d.ok) continue;
      expect(encodePlay({ ...d.play })).toBe(text);
    }
  });

  it('入力なし・同じ引数なら同じ文字列', () => {
    const args = { rulesVersion: 1, seed: 0, inputs: [], endTick: 7200 };
    const a = encodePlay(args);
    const b = encodePlay(args);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
    const d = decodePlay(a);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.play.inputs).toHaveLength(0);
    expect(d.play.endTick).toBe(7200);
  });

  it('endTick を省略すると最後の入力の tick になる', () => {
    const d = decodePlay(encodePlay({ rulesVersion: 1, seed: 7, inputs: [drop(10, 0.5), drop(300, 0.6)] }));
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.play.endTick).toBe(300);
  });

  it('おかしい入力は空文字列を返す（例外なし）', () => {
    const ok = { rulesVersion: 1, seed: 1 };
    expect(encodePlay({ ...ok, inputs: [{ ...drop(0, 0), tick: -1 }] })).toBe('');
    expect(encodePlay({ ...ok, inputs: [drop(300, 0), drop(10, 0)] })).toBe(''); // 時系列が逆
    expect(encodePlay({ ...ok, inputs: [{ ...drop(0, 0), vx: Number.NaN }] })).toBe('');
    expect(encodePlay({ ...ok, inputs: [{ ...drop(0, 0), vy: Infinity }] })).toBe('');
    expect(encodePlay({ ...ok, inputs: [{ ...drop(0, 0), originAngleRadians: NaN }] })).toBe('');
    expect(encodePlay({ ...ok, inputs: [drop(10, 0)], endTick: 5 })).toBe(''); // 入力が終了を越える
    expect(encodePlay({ rulesVersion: 300, seed: 1, inputs: [] })).toBe('');
    expect(encodePlay({ rulesVersion: -1, seed: 1, inputs: [] })).toBe('');
    expect(encodePlay({ rulesVersion: 1, seed: 0x100000000, inputs: [] })).toBe('');
    expect(encodePlay({ rulesVersion: 1, seed: 1, inputs: [], endTick: -1 })).toBe('');
    expect(encodePlay({ rulesVersion: 1, seed: 1, inputs: [], endTick: MAX_TICKS + 1 })).toBe('');
    expect(encodePlay({ rulesVersion: 1, seed: 1, inputs: [], endTick: 1.5 })).toBe('');
    // 型を越えた要素（実行時に紛れうる null・数・文字列）でも落ちない
    expect(encodePlay({ ...ok, inputs: [null as unknown as LaunchInput] })).toBe('');
    expect(encodePlay({ ...ok, inputs: [42 as unknown as LaunchInput] })).toBe('');
    expect(encodePlay({ ...ok, inputs: ['x' as unknown as LaunchInput] })).toBe('');
    // endTick 指定済みで途中の要素が null でも落ちない
    expect(encodePlay({ ...ok, endTick: 5, inputs: [drop(0, 0.5), null as unknown as LaunchInput] })).toBe('');
    // inputs が配列でない・引数自体が null でも落ちない
    expect(encodePlay({ ...ok, inputs: null as unknown as LaunchInput[] })).toBe('');
    expect(encodePlay({ ...ok, inputs: 42 as unknown as LaunchInput[] })).toBe('');
    expect(encodePlay(null as unknown as EncodePlayArgs)).toBe('');
  });

  it('上限を越える物は空文字列を返す', () => {
    // 入力の数が上限（100,000）を越える
    const tooMany: LaunchInput[] = Array.from({ length: 100_001 }, () => drop(0, 0.5));
    expect(encodePlay({ rulesVersion: 1, seed: 1, endTick: 100, inputs: tooMany })).toBe('');
    // 文字列の上限（262,144 文字）を越える = 全部「投げる」だと約 8,000 入力で頭打ち
    const raws: LaunchInput[] = Array.from({ length: 9_000 }, (_, i) => ({
      tick: i * 60,
      originAngleRadians: i * 0.137,
      vx: 300 + i * 0.01,
      vy: -100,
    }));
    expect(encodePlay({ rulesVersion: 1, seed: 1, endTick: 9_000 * 60, inputs: raws })).toBe('');
  });
});

describe('decodePlay の頑丈さ', () => {
  const sample = encodePlay({
    rulesVersion: 1,
    seed: 123,
    endTick: 5000,
    inputs: Array.from({ length: 30 }, (_, i) => drop(50 + i * 120, gridAngle(i * 65536 + 7))),
  });

  it('決まった形の異常を全部弾く', () => {
    expect(decodePlay('').ok).toBe(false);
    expect(decodePlay('   \n').ok).toBe(false);
    expect(decodePlay('a').ok).toBe(false);
    const huge = decodePlay('A'.repeat(300_000));
    expect(huge.ok).toBe(false);
    if (!huge.ok) expect(huge.reason).toBe('tooLong');
    expect(decodePlay(sample + ' ').ok).toBe(true); // 前後の空白は落として読む
    expect(decodePlay(sample + 'A').ok).toBe(false); // 1 文字増えると壊れる
    expect(decodePlay('あいうえお').ok).toBe(false);
  });

  it('文字列でない物を渡されても落ちない', () => {
    for (const v of [undefined, null, 0, 42, {}, [], true]) {
      expect(decodePlay(v as unknown as string).ok).toBe(false);
    }
  });

  it('途中で切れた文字列は全部失敗する', () => {
    for (let len = 1; len < sample.length; len++) {
      expect(decodePlay(sample.slice(0, len)).ok).toBe(false);
    }
  });

  it('末尾の余りビットを立てた非正規の形は弾く', () => {
    // 10 バイト（%3==1）になる文字列を作る → 末尾は 2 文字、下位 4 bit が余り
    const text = encodePlay({ rulesVersion: 1, seed: 0, inputs: [], endTick: 128 });
    const last = B64URL.indexOf(text[text.length - 1]!);
    expect(last & 15).toBe(0); // 正規の詰めなら余りビットは 0
    const mutated = text.slice(0, -1) + B64URL[last | 1]!;
    const d = decodePlay(mutated);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('badCharacter');
  });

  it('検査値を付け直しても、形式の版が違えば badVersion で弾く', () => {
    const bytes = base64UrlToBytes(sample);
    expect(bytes).not.toBe(null);
    if (!bytes) return;
    const forged = Uint8Array.from(bytes);
    forged[0] = 99; // 形式の版だけを書き換える
    const body = forged.subarray(0, forged.length - 4);
    const sum = fnv1a(body); // 検査値を正しく付け直す
    forged[forged.length - 4] = sum & 255;
    forged[forged.length - 3] = (sum >>> 8) & 255;
    forged[forged.length - 2] = (sum >>> 16) & 255;
    forged[forged.length - 1] = (sum >>> 24) & 255;
    const d = decodePlay(bytesToBase64Url(forged));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('badVersion');
  });

  it('検査値が合っていても、末尾に余分なバイトがあれば弾く', () => {
    const bytes = base64UrlToBytes(sample);
    expect(bytes).not.toBe(null);
    if (!bytes) return;
    // 入力の並びの後ろに余分な 1 バイトを足し、検査値を付け直す → 読み切れず弾かれるはず
    const grown = new Uint8Array(bytes.length + 1);
    grown.set(bytes.subarray(0, bytes.length - 4)); // 元の本体
    grown[bytes.length - 4] = 0; // 余分な 0 バイト
    const body = grown.subarray(0, grown.length - 4);
    const sum = fnv1a(body); // 検査値を正しく付け直す
    grown[grown.length - 4] = sum & 255;
    grown[grown.length - 3] = (sum >>> 8) & 255;
    grown[grown.length - 2] = (sum >>> 16) & 255;
    grown[grown.length - 1] = (sum >>> 24) & 255;
    const d = decodePlay(bytesToBase64Url(grown));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('badData');
  });

  it('1 文字だけ変えた文字列はほぼ全部「壊れている」と分かる', () => {
    let undetected = 0;
    for (let i = 0; i < sample.length; i++) {
      const replaced = B64URL[(B64URL.indexOf(sample[i]!) + 1) % B64URL.length]!;
      const mutated = sample.slice(0, i) + replaced + sample.slice(i + 1);
      const d = decodePlay(mutated);
      if (d.ok) {
        undetected++;
        // 万が一読めてしまっても、再び文字列にできる形であること
        expect(encodePlay({ ...d.play })).not.toBe('');
      }
    }
    expect(undetected / sample.length).toBeLessThan(0.01);
  });

  it('でたらめな文字列を 10,000 個入れても 1 つも落ちず、全部失敗する', () => {
    const rng = createRng(20261016);
    const noise = ' =!?@#$%^&*(){}[]あ🙂\n\t+/|~';
    for (let i = 0; i < 10000; i++) {
      const len = Math.floor(rng() * 48);
      let s = '';
      for (let j = 0; j < len; j++) {
        s += rng() < 0.7 ? B64URL[Math.floor(rng() * 64)]! : noise[Math.floor(rng() * noise.length)]!;
      }
      expect(decodePlay(s).ok).toBe(false);
    }
  });
});
