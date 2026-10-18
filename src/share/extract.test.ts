// 貼り付け口（extractShareText）の確かめ。
// 「URL をそのまま貼った」「説明文ごとコピーした」形で届いた文章から、
// 正当な共有文字列だけを取り出せるかを見る。
// 正当性の判定は decodePlay に任せる設計なので、ここで確かめるのは「拾い方」:
// 連なりの集め方・長い順・数と長さの上限・取り出せない形。

import { describe, expect, it } from 'vitest';
import type { LaunchInput } from '../contracts/game';
import { dropAt } from '../fixtures';
import { DROP_SPEED } from '../game/constants';
import { createRng } from '../game/rng';
import { createSimulation } from '../game/simulation';
import { decodePlay, encodePlay, MAX_TEXT_LENGTH, SHARE_RULES_VERSION } from './codec';
import { extractShareText, MAX_ATTEMPTS, MAX_CANDIDATES } from './extract';
import { verifyPlay } from './verify';

const GRID_DENOM = 4294967296;

/** rng() * Math.PI * 2 と同じ計算順で、格子（2π/2^32）上の角度を作る。 */
function gridAngle(k: number): number {
  return (k / GRID_DENOM) * Math.PI * 2;
}

/** 「押して離す」で出る入力（dropAt と同じ式）。 */
function drop(tick: number, angle: number): LaunchInput {
  // シミュレーションと同じく速度を整数に丸める（src/game/predictor.ts の quantizeLaunch）
  return { tick, originAngleRadians: angle, vx: Math.round(-Math.cos(angle) * DROP_SPEED) + 0, vy: Math.round(-Math.sin(angle) * DROP_SPEED) + 0 };
}

/**
 * 長さ (quads*4+1) の 'A' の連なり。
 * base64 では %4==1 の長さが存在しないので、decode が必ず弾く「絶対に読めない連なり」になる
 * （検査値の偶然の一致を気にせず済む）。
 */
const junkRun = (quads: number): string => 'A'.repeat(quads * 4 + 1);

// 最小（入力なし → 本体 5 バイト + 検査値 4 = 9 バイト → 12 文字）と、少し長い（入力 5 個）の 2 種類。
const MINIMAL = encodePlay({ rulesVersion: SHARE_RULES_VERSION, seed: 0, inputs: [], endTick: 0 });
const WITH_INPUTS = encodePlay({
  rulesVersion: SHARE_RULES_VERSION,
  seed: 42,
  endTick: 700,
  inputs: Array.from({ length: 5 }, (_, i) => drop(60 + i * 120, gridAngle(1000 + i * 7777))),
});

describe('extractShareText', () => {
  it('共有文字列そのまま、または前後に空白があっても取り出す', () => {
    // 拾う連なりの下限（12 文字）とちょうど同じ長さの最小の共有文字列
    expect(MINIMAL.length).toBe(12);
    expect(WITH_INPUTS.length).toBeGreaterThan(MINIMAL.length);
    expect(extractShareText(MINIMAL)).toBe(MINIMAL);
    expect(extractShareText(WITH_INPUTS)).toBe(WITH_INPUTS);
    expect(extractShareText(`  \n${WITH_INPUTS}\t `)).toBe(WITH_INPUTS);
    // 内部の正規表現に状態が残らず、2 回呼んでも同じ結果になること
    expect(extractShareText(WITH_INPUTS)).toBe(WITH_INPUTS);
  });

  it('文章や URL の中から取り出す（区切りは base64url 以外の文字なら何でもよい）', () => {
    expect(extractShareText(`このプレイを見て ${WITH_INPUTS} すごい`)).toBe(WITH_INPUTS);
    expect(extractShareText(`https://example.com/replay?d=${WITH_INPUTS}&from=chat`)).toBe(WITH_INPUTS);
    expect(extractShareText(`https://example.com/r/${WITH_INPUTS}`)).toBe(WITH_INPUTS);
    expect(extractShareText(`(${WITH_INPUTS})`)).toBe(WITH_INPUTS);
    expect(extractShareText(`「${WITH_INPUTS}」を貼った`)).toBe(WITH_INPUTS);
    expect(extractShareText(`1行目\n${WITH_INPUTS}\n3行目`)).toBe(WITH_INPUTS);
  });

  it('読めない連なりが混ざっていても、長い順に試して正当な物へ届く', () => {
    // 共有文字列より長い偽物があっても、そちらは読めないので正当な物が返る
    const longerJunk = junkRun(30); // 121 文字
    expect(longerJunk.length).toBeGreaterThan(WITH_INPUTS.length);
    expect(extractShareText(`${longerJunk} ${WITH_INPUTS}`)).toBe(WITH_INPUTS);
    expect(extractShareText(`${WITH_INPUTS} ${longerJunk}`)).toBe(WITH_INPUTS);
  });

  it('正当な物が 2 つあると長い方を返し、同じ長さなら先に現れた方を返す', () => {
    expect(extractShareText(`${MINIMAL} ${WITH_INPUTS}`)).toBe(WITH_INPUTS);
    expect(extractShareText(`${WITH_INPUTS} ${MINIMAL}`)).toBe(WITH_INPUTS);
    // 同じ長さの正当な物 2 つ（seed だけが違う）→ sort は安定なので先に現れた方
    const a = encodePlay({ rulesVersion: SHARE_RULES_VERSION, seed: 1, inputs: [], endTick: 7 });
    const b = encodePlay({ rulesVersion: SHARE_RULES_VERSION, seed: 2, inputs: [], endTick: 7 });
    expect(a).not.toBe(b);
    expect(a.length).toBe(b.length);
    expect(extractShareText(`${a} ${b}`)).toBe(a);
    expect(extractShareText(`${b} ${a}`)).toBe(b);
  });

  it('文字列でない物・空・短い連なりだけの文章は null', () => {
    for (const v of [undefined, null, 0, 42, {}, [], true, new String(WITH_INPUTS)]) {
      expect(extractShareText(v)).toBe(null);
    }
    expect(extractShareText('')).toBe(null);
    expect(extractShareText('   \n\t ')).toBe(null);
    // 11 文字以下の連なりは最小の共有文字列（12 文字）より短いので拾わない
    expect(extractShareText('abc DEF-ghi_jk')).toBe(null);
    expect(extractShareText('hello world')).toBe(null);
    expect(extractShareText('共有文字列はここにあります')).toBe(null);
  });

  it('共有文字列に base64url の文字が区切りなしで続くと取り出せない（既知の限界）', () => {
    // くっ付いた分まで連なりの一部と見なされる。3 文字足すと全体が %4==1 の長さになり、
    // base64 として成り立たないので必ず弾かれる（検査値の偶然の一致を気にしなくてよい）
    expect(WITH_INPUTS.length % 4).toBe(2);
    expect(extractShareText(`${WITH_INPUTS}xyz`)).toBe(null);
    expect(extractShareText(`xyz${WITH_INPUTS}`)).toBe(null);
    expect(extractShareText(`${MINIMAL}a`)).toBe(null); // 12+1=13 も %4==1
    // 区切りが 1 文字でもあれば取り出せる
    expect(extractShareText(`${WITH_INPUTS}!`)).toBe(WITH_INPUTS);
    expect(extractShareText(`${WITH_INPUTS}。`)).toBe(WITH_INPUTS);
  });

  it('base64（標準）の = + / は区切りとして働き、URL を通しても壊れない', () => {
    // 手で padding を付け足した形・data URL 風の形でも、連なりがそこで切れるので取り出せる
    expect(extractShareText(`${WITH_INPUTS}==`)).toBe(WITH_INPUTS);
    expect(extractShareText(`${WITH_INPUTS}+`)).toBe(WITH_INPUTS);
    expect(extractShareText(`data:text/plain;base64,${WITH_INPUTS}`)).toBe(WITH_INPUTS);
    // base64url の文字は URL を通しても変化しない（パーセントエンコードされない）
    const url = new URL(`https://example.com/r?d=${WITH_INPUTS}`);
    expect(extractShareText(url.toString())).toBe(WITH_INPUTS);
  });

  it('MAX_TEXT_LENGTH を越える連なりは候補から外す', () => {
    const huge = 'A'.repeat(MAX_TEXT_LENGTH + 7); // 連なりが長すぎても落ちない
    expect(extractShareText(huge)).toBe(null);
    // 巨大な連なりの後ろに正当な物があれば、そちらは拾う
    expect(extractShareText(`${huge} ${WITH_INPUTS}`)).toBe(WITH_INPUTS);
    // 上限ちょうどの連なりは候補に残る（中身が読めるかは decodePlay の仕事。
    // 'A' の並びは全部 0 バイトに読めて検査値が合わない —— tamper.test.ts で確かめ済み）
    expect(extractShareText('A'.repeat(MAX_TEXT_LENGTH))).toBe(null);
  });

  it('拾う連なりは先に現れた順に MAX_CANDIDATES 個まで。それ以降は見ない（DoS 対策の上限）', () => {
    // 全部「絶対に読めない連なり」なので、末尾の正当な物が拾い枠に届かなければ null になる
    const many = Array.from({ length: MAX_CANDIDATES + 100 }, (_, i) => junkRun(4 + (i % 12))).join(' ');
    expect(extractShareText(`${many} ${WITH_INPUTS}`)).toBe(null);
    // 正当な物が枠の内側（先頭から上限ぶんの中）にあれば取り出せる
    const few = Array.from({ length: 100 }, (_, i) => junkRun(4 + (i % 12))).join(' ');
    expect(extractShareText(`${few} ${WITH_INPUTS}`)).toBe(WITH_INPUTS);
  });

  it('decode にかける候補は長い順に MAX_ATTEMPTS 個まで。それより後は見ない', () => {
    // 前提: 使う偽物は全部共有文字列より長い（正当な物が必ず末尾側の順位になる）
    expect(junkRun(15).length).toBeGreaterThan(WITH_INPUTS.length);
    // 上限未満の個数なら、偽物を全部弾いた後に正当な物へ届く
    const under = Array.from({ length: MAX_ATTEMPTS - 4 }, (_, i) => junkRun(15 + i)).join(' ');
    expect(extractShareText(`${under} ${WITH_INPUTS}`)).toBe(WITH_INPUTS);
    // 上限を越える個数だと打ち切られ、正当な物には届かない
    const over = Array.from({ length: MAX_ATTEMPTS + 6 }, (_, i) => junkRun(15 + i)).join(' ');
    expect(extractShareText(`${over} ${WITH_INPUTS}`)).toBe(null);
  });

  it('上限ぎりぎりの重い連なりが並んでいても、作業量は上限で頭打ちになる', () => {
    // 最も遅い形: 上限ちょうど & base64 としては読めるが検査値で弾かれる連なりが複数
    const heavy = `${'A'.repeat(MAX_TEXT_LENGTH)} `.repeat(4) + WITH_INPUTS;
    const t0 = performance.now();
    expect(extractShareText(heavy)).toBe(WITH_INPUTS);
    const ms = performance.now() - t0;
    console.info(`[share] extract 重い候補 4 件 + 正当な物: ${ms.toFixed(1)}ms`);
    // 実際は数十 ms 程度。極端に遅い検査環境でも落ちないよう上限は緩く
    expect(ms).toBeLessThan(30_000);
  });

  it('取り出した文字列はそのまま verifyPlay で再生できる（貼り付け → 再生の一通り）', () => {
    const seed = 12345;
    const sim = createSimulation(seed);
    sim.submitLaunch(dropAt(0.4));
    for (let i = 0; i < 300; i++) sim.stepFixed();
    sim.submitLaunch(dropAt(2.1));
    for (let i = 0; i < 400; i++) sim.stepFixed();
    const snap = sim.getSnapshot();
    expect(sim.getInputLog()).toHaveLength(2); // 前提: 2 発とも受理されている
    const text = encodePlay({
      rulesVersion: SHARE_RULES_VERSION,
      seed,
      inputs: sim.getInputLog(),
      endTick: snap.tick,
    });
    expect(text).not.toBe('');
    const pasted = extractShareText(`https://example.com/r?d=${text}&t=chat`);
    expect(pasted).toBe(text);
    if (pasted === null) return;
    const v = verifyPlay(pasted);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.result.score).toBe(snap.score);
    expect(v.result.ticks).toBe(snap.tick);
    expect(v.result.inputsApplied).toBe(2);
  });

  it('でたらめな文章を何件入れても落ちず、返る物は必ず decode が通る連なり', () => {
    const rng = createRng(999);
    const alphabet = 'abcXYZ019_- =.?#/&あ。🙂\n';
    for (let i = 0; i < 2000; i++) {
      let s = '';
      const len = Math.floor(rng() * 120);
      for (let j = 0; j < len; j++) s += alphabet[Math.floor(rng() * alphabet.length)]!;
      const got = extractShareText(s);
      // 万が一拾えた物があっても、それは decodePlay が通した連なりでなければならない
      if (got !== null) expect(decodePlay(got).ok).toBe(true);
    }
  });
});
