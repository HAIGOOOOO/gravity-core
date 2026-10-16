import { describe, expect, it } from 'vitest';
import type { LaunchInput } from '../contracts/game';
import { createAutoPlay, dropAt } from '../fixtures';
import { DROP_SPEED, TICK_HZ } from '../game/constants';
import { createRng } from '../game/rng';
import { createSimulation } from '../game/simulation';
import { decodePlay, encodePlay, SHARE_RULES_VERSION } from './codec';
import { verifyPlay } from './verify';

describe('verifyPlay', () => {
  it('自動プレイ 20 回を文字列にして戻すと、最後の得点が元と一致する', () => {
    for (let i = 0; i < 20; i++) {
      const seed = 1000 + i;
      const auto = createAutoPlay(seed);
      const ticks = 15 * TICK_HZ;
      while (auto.sim.getSnapshot().tick < ticks && auto.sim.getSnapshot().phase === 'active') auto.step();
      const snap = auto.sim.getSnapshot();
      const text = encodePlay({ rulesVersion: SHARE_RULES_VERSION, seed, inputs: auto.sim.getInputLog(), endTick: snap.tick });
      const v = verifyPlay(text);
      expect(v.ok).toBe(true);
      if (!v.ok) continue;
      expect(v.result.score).toBe(snap.score);
      expect(v.result.ticks).toBe(snap.tick);
      expect(v.result.stats).toEqual(snap.stats); // 戦績も再生し直した値が入る
      expect(v.result.inputsApplied).toBe(v.result.inputsTotal);
      expect(v.result.inputsTotal).toBeGreaterThan(0);
    }
  }, 120_000);

  it('「まっすぐ」以外の入力（投げる）を含むプレイも完全一致する', () => {
    const seed = 777;
    const sim = createSimulation(seed);
    sim.submitLaunch(dropAt((1234567 / 4294967296) * Math.PI * 2)); // tick 0、格子の角度
    for (let i = 0; i < 70; i++) sim.stepFixed();
    sim.submitLaunch(dropAt(2.35)); // 格子に乗らない「まっすぐ」
    for (let i = 0; i < 70; i++) sim.stepFixed();
    const a = 0.9; // 接線方向へ投げる
    const r = sim.submitLaunch({ originAngleRadians: a, vx: -Math.sin(a) * 480, vy: Math.cos(a) * 480 });
    expect(r.accepted).toBe(true);
    for (let i = 0; i < 600; i++) sim.stepFixed();

    const inputs = sim.getInputLog();
    expect(inputs).toHaveLength(3);
    const snap = sim.getSnapshot();
    const text = encodePlay({ rulesVersion: SHARE_RULES_VERSION, seed, inputs, endTick: snap.tick });

    const d = decodePlay(text);
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.play.inputs).toEqual(inputs);

    const v = verifyPlay(text);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.result.score).toBe(snap.score);
      expect(v.result.stats).toEqual(snap.stats); // 合体・連鎖などの戦績も一致する
      expect(v.result.inputsApplied).toBe(3);
    }
  });

  it('途中までの共有: endTick がプレイより前ならそこで止まり、その時点の得点を返す', () => {
    const seed = 555;
    const auto = createAutoPlay(seed);
    const mid = 10 * TICK_HZ; // 10 秒時点
    while (auto.sim.getSnapshot().tick < mid && auto.sim.getSnapshot().phase === 'active') auto.step();
    const midSnap = auto.sim.getSnapshot();
    expect(midSnap.phase).toBe('active'); // 10 秒で終わっていることはあり得ない
    // ここで文字列化する（入力ログは mid 時点の物だけ入っている）
    const text = encodePlay({
      rulesVersion: SHARE_RULES_VERSION,
      seed,
      inputs: auto.sim.getInputLog(),
      endTick: midSnap.tick,
    });
    const v = verifyPlay(text);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.result.ticks).toBe(midSnap.tick);
    expect(v.result.score).toBe(midSnap.score);
    expect(v.result.gameOver).toBe(false);
  }, 120_000);

  it('endTick が実際の終了より後でも、再生はゲームが終わった所で止まる', () => {
    const seed = 909;
    const auto = createAutoPlay(seed);
    const limit = 90 * TICK_HZ; // 90 秒またはゲームオーバーまで
    while (auto.sim.getSnapshot().tick < limit && auto.sim.getSnapshot().phase === 'active') auto.step();
    const playedSnap = auto.sim.getSnapshot();

    // endTick を実際に進めた所より後にする（終わっていたら越える、続いていたら未来）
    const extraEnd = playedSnap.tick + 20000;
    const text = encodePlay({
      rulesVersion: SHARE_RULES_VERSION,
      seed,
      inputs: auto.sim.getInputLog(),
      endTick: extraEnd,
    });
    expect(text).not.toBe('');

    // 正解: 同じ sim を「入力なしで」endTick まで（またはオーバーまで）進めた物
    while (auto.sim.getSnapshot().tick < extraEnd && auto.sim.getSnapshot().phase === 'active') {
      auto.sim.stepFixed();
    }
    const expected = auto.sim.getSnapshot();

    const v = verifyPlay(text);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.result.ticks).toBe(expected.tick);
    expect(v.result.score).toBe(expected.score);
    expect(v.result.gameOver).toBe(expected.phase === 'over');
    // 終わっていたなら ticks は endTick より小さい
    if (expected.phase === 'over') expect(v.result.ticks).toBeLessThan(extraEnd);
  }, 120_000);

  it('同じ tick に複数の入力がある文字列は、受理された分だけ正直に数える', () => {
    const drop = (tick: number, angle: number): LaunchInput => ({
      tick,
      originAngleRadians: angle,
      vx: -Math.cos(angle) * DROP_SPEED,
      vy: -Math.sin(angle) * DROP_SPEED,
    });
    const inputs: LaunchInput[] = [drop(5, 0.5), drop(5, 1.5)]; // 2 発目はクールダウン中
    const text = encodePlay({ rulesVersion: SHARE_RULES_VERSION, seed: 3, endTick: 300, inputs });
    const v = verifyPlay(text);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.result.inputsTotal).toBe(2);
    expect(v.result.inputsApplied).toBe(1); // 2 発目は受理されない
    expect(v.result.ticks).toBe(300);
  });

  it('3 分のプレイの文字列は 2,000 文字以内で、再生した得点も一致する', () => {
    const seed = 20261016;
    const auto = createAutoPlay(seed);
    const ticks = 3 * 60 * TICK_HZ;
    while (auto.sim.getSnapshot().tick < ticks && auto.sim.getSnapshot().phase === 'active') auto.step();
    const snap = auto.sim.getSnapshot();
    const inputs = auto.sim.getInputLog();
    const t0 = performance.now();
    const text = encodePlay({ rulesVersion: SHARE_RULES_VERSION, seed, inputs, endTick: snap.tick });
    const t1 = performance.now();
    const d = decodePlay(text);
    const t2 = performance.now();
    const v = verifyPlay(text);
    const t3 = performance.now();
    console.info(
      `[share] 3分プレイ: inputs=${inputs.length} 文字数=${text.length} ` +
        `encode=${(t1 - t0).toFixed(1)}ms decode=${(t2 - t1).toFixed(1)}ms verify=${(t3 - t2).toFixed(1)}ms`,
    );
    expect(inputs.length).toBeGreaterThan(50);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(d.ok).toBe(true);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.result.score).toBe(snap.score);
    // 遅い検査環境でも落ちない程度の、ざっくりした上限
    expect(t3 - t0).toBeLessThan(90_000);
  }, 120_000);

  it('同じ文字列は何度再生しても同じ結果を返す（再生は決定的）', () => {
    const seed = 4242;
    const auto = createAutoPlay(seed);
    for (let i = 0; i < 900; i++) auto.step();
    const snap = auto.sim.getSnapshot();
    const text = encodePlay({
      rulesVersion: SHARE_RULES_VERSION,
      seed,
      inputs: auto.sim.getInputLog(),
      endTick: snap.tick,
    });
    const a = verifyPlay(text);
    const b = verifyPlay(text);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.result).toEqual(b.result);
  }, 120_000);

  it('ルールの版が違う文字列は rulesMismatch で弾く', () => {
    const text = encodePlay({ rulesVersion: SHARE_RULES_VERSION + 1, seed: 1, inputs: [], endTick: 0 });
    expect(decodePlay(text).ok).toBe(true); // 文字列としては正しい
    expect(verifyPlay(text)).toEqual({ ok: false, reason: 'rulesMismatch' });
  });

  it('受理されない入力を含む文字列は、入力を捨てて正直に再生する', () => {
    const inputs: LaunchInput[] = [{ tick: 10, originAngleRadians: 0.3, vx: 9999, vy: 9999 }];
    const text = encodePlay({ rulesVersion: SHARE_RULES_VERSION, seed: 9, endTick: 300, inputs });
    const v = verifyPlay(text);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.result.inputsApplied).toBe(0); // 速すぎて受理されない
    expect(v.result.score).toBe(0);
    expect(v.result.ticks).toBe(300);
  });

  it('1 文字でも変わった文字列は弾き、でたらめな文字列 1,000 個でも落ちない', () => {
    const auto = createAutoPlay(31);
    for (let i = 0; i < 600; i++) auto.step();
    const text = encodePlay({
      rulesVersion: SHARE_RULES_VERSION,
      seed: 31,
      inputs: auto.sim.getInputLog(),
      endTick: auto.sim.getSnapshot().tick,
    });
    const mid = Math.floor(text.length / 2);
    const broken = text.slice(0, mid) + (text[mid] === 'A' ? 'B' : 'A') + text.slice(mid + 1);
    expect(verifyPlay(broken).ok).toBe(false);
    expect(verifyPlay(text.slice(0, mid)).ok).toBe(false); // 途中で切れた

    const rng = createRng(31337);
    for (let i = 0; i < 1000; i++) {
      const len = Math.floor(rng() * 40);
      let s = '';
      for (let j = 0; j < len; j++) s += String.fromCharCode(Math.floor(rng() * 65536));
      expect(verifyPlay(s).ok).toBe(false);
    }
  });
});
