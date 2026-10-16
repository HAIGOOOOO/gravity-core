import { describe, expect, it } from 'vitest';
import type { GameSnapshot, LaunchInput } from '../contracts/game';
import { createAutoPlay, dropAt } from '../fixtures';
import { DROP_SPEED, TICK_HZ } from '../game/constants';
import { createRng } from '../game/rng';
import { createSimulation } from '../game/simulation';
import { decodePlay, encodePlay, SHARE_RULES_VERSION } from './codec';
import { verifyPlay, type VerifyOptions } from './verify';

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
    if (expected.phase === 'over') {
      expect(v.result.ticks).toBeLessThan(extraEnd);
      // 終了時刻が上限内なら、endTick が上限を越えていても再生し切れる（終わりまでしか進まないため）
      const cappedOver = verifyPlay(text, { maxTicks: expected.tick });
      expect(cappedOver.ok).toBe(true);
      if (cappedOver.ok) expect(cappedOver.result.ticks).toBe(expected.tick);
    }
  }, 120_000);

  it('ゲームオーバー後の tick に入力がある文字列は、終了時点で止まり結果を返す', () => {
    // 標準開始の盤面でオーバーを起こす必要があるので、狭い角度へ撃ち続けて山を意図的に偏らせる。
    // まっすぐ落としは必ずどこかへ積もるので、撃ち続ければいずれ限界リングを越える。
    const t0 = performance.now();
    let found: { seed: number; sim: ReturnType<typeof createSimulation>; snap: GameSnapshot } | null = null;
    for (const seed of [616, 77, 2026]) {
      const sim = createSimulation(seed);
      const rng = createRng(seed + 9);
      let nextLaunch = 0;
      const limit = 150 * TICK_HZ; // 最長 150 秒ぶんまで試す
      for (;;) {
        const snap = sim.getSnapshot();
        if (snap.phase !== 'active' || snap.tick >= limit) break;
        if (snap.tick >= nextLaunch) {
          sim.submitLaunch(dropAt(-Math.PI / 2 + (rng() - 0.5) * 0.6)); // 真上 ±0.3 rad
          nextLaunch = snap.tick + 65; // クールダウン 0.5s = 60 tick に余裕を持たせる
        }
        sim.stepFixed();
      }
      const snap = sim.getSnapshot();
      if (snap.phase === 'over') {
        found = { seed, sim, snap };
        break;
      }
    }
    console.info(`[share] オーバー再現まで: ${(performance.now() - t0).toFixed(1)}ms`);
    if (!found) {
      // オーバーに至らない環境ではここで終わる。
      // 終了済みの sim に入力が来たときの分岐は「実際の終了より後」テストでも条件付きで確かめている。
      console.info('[share] 試したシードではオーバーに至らず、後半は未確認');
      return;
    }
    const base = found.sim.getInputLog();
    expect(base.length).toBeGreaterThan(0);
    // 終了時点より後の tick に入力を足した文字列を作る
    const extraTick = found.snap.tick + 100;
    const inputs: LaunchInput[] = [...base, { tick: extraTick, ...dropAt(1.1) }];
    const text = encodePlay({
      rulesVersion: SHARE_RULES_VERSION,
      seed: found.seed,
      inputs,
      endTick: extraTick + 500,
    });
    expect(text).not.toBe('');
    const v = verifyPlay(text);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.result.gameOver).toBe(true);
    expect(v.result.ticks).toBe(found.snap.tick); // endTick まで進まず終了時点で止まる
    expect(v.result.score).toBe(found.snap.score);
    expect(v.result.inputsApplied).toBe(base.length); // オーバー後の入力は捨てられる
    expect(v.result.inputsTotal).toBe(inputs.length);
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

  it('最後の入力がちょうど endTick の位置にあるプレイも再生できる', () => {
    const inputs: LaunchInput[] = [{ tick: 240, ...dropAt(0.9) }];
    const text = encodePlay({ rulesVersion: SHARE_RULES_VERSION, seed: 5, inputs, endTick: 240 });
    expect(text).not.toBe('');
    const v = verifyPlay(text);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.result.ticks).toBe(240);
    expect(v.result.inputsApplied).toBe(1); // クールダウン無しで受理される
    expect(v.result.inputsTotal).toBe(1);
  }, 120_000);

  it('入力なし・endTick 0 のプレイは得点 0 で再生できる（endTick 省略でも同じ文字列）', () => {
    const text = encodePlay({ rulesVersion: SHARE_RULES_VERSION, seed: 1, inputs: [], endTick: 0 });
    expect(encodePlay({ rulesVersion: SHARE_RULES_VERSION, seed: 1, inputs: [] })).toBe(text);
    const v = verifyPlay(text);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.result.score).toBe(0);
    expect(v.result.ticks).toBe(0);
    expect(v.result.gameOver).toBe(false);
    expect(v.result.inputsTotal).toBe(0);
  });

  it('decode の失敗理由が verify の失敗理由にそのまま出る', () => {
    expect(verifyPlay('')).toEqual({ ok: false, reason: 'empty' });
    expect(verifyPlay('!!')).toEqual({ ok: false, reason: 'badCharacter' });
    expect(verifyPlay('AQ')).toEqual({ ok: false, reason: 'truncated' }); // 1 バイトだけ読めても本体が足りない
  });

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

  it('入力なし・endTick だけあるプレイはその tick まで進み、得点 0 を返す', () => {
    const text = encodePlay({ rulesVersion: SHARE_RULES_VERSION, seed: 4, inputs: [], endTick: 600 });
    const v = verifyPlay(text);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.result.ticks).toBe(600);
    expect(v.result.score).toBe(0);
    expect(v.result.inputsTotal).toBe(0);
    expect(v.result.gameOver).toBe(false);
  });

  it('options の getter が投げても例外は外へ出ない', () => {
    const text = encodePlay({ rulesVersion: SHARE_RULES_VERSION, seed: 1, inputs: [], endTick: 0 });
    const evil = {
      get maxTicks(): number {
        throw new Error('trap');
      },
    };
    const v = verifyPlay(text, evil);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('badData');
  });
});

describe('verifyPlay の再生上限（maxTicks）', () => {
  /** codec.ts のプレイ長の上限と同じ（= 4 時間）。細工された巨大 endTick の文字列用。 */
  const MAX_TICKS = TICK_HZ * 60 * 60 * 4;

  it('上限を付けると、巨大な endTick の文字列を速く打ち切る', () => {
    // 正当だが入力なし・endTick 最大の文字列。上限なしだと 4 時間ぶん（約 172 万 tick）再生する
    const text = encodePlay({ rulesVersion: SHARE_RULES_VERSION, seed: 1, inputs: [], endTick: MAX_TICKS });
    expect(text).not.toBe('');
    const t0 = performance.now();
    const v = verifyPlay(text, { maxTicks: 3600 });
    const ms = performance.now() - t0;
    console.info(`[share] maxTicks=3600 で打ち切り: ${ms.toFixed(1)}ms`);
    expect(v).toEqual({ ok: false, reason: 'tooLongToVerify' });
    // 実際は数十 ms 以下で返るはず。極端に遅い検査環境でも落ちないよう緩い足切り
    expect(ms).toBeLessThan(30_000);
  });

  it('上限が足りれば上限なしと同じ結果を返し、足りなければ弾く', () => {
    const seed = 8888;
    const auto = createAutoPlay(seed);
    for (let i = 0; i < 1200; i++) auto.step(); // 10 秒ぶん
    const snap = auto.sim.getSnapshot();
    expect(snap.phase).toBe('active'); // 10 秒で終わることはあり得ない
    const inputs = auto.sim.getInputLog();
    const lastInputTick = inputs[inputs.length - 1]!.tick;
    const text = encodePlay({
      rulesVersion: SHARE_RULES_VERSION,
      seed,
      inputs,
      endTick: snap.tick,
    });

    const full = verifyPlay(text);
    const capped = verifyPlay(text, { maxTicks: snap.tick });
    expect(full.ok && capped.ok).toBe(true);
    if (full.ok && capped.ok) expect(capped.result).toEqual(full.result);

    // endTick より 1 つ小さい上限 → 再生の末尾で届かず弾く
    expect(verifyPlay(text, { maxTicks: snap.tick - 1 })).toEqual({
      ok: false,
      reason: 'tooLongToVerify',
    });
    // 最後の入力の tick に届かない上限 → 入力のループ側で弾く
    expect(verifyPlay(text, { maxTicks: lastInputTick - 1 })).toEqual({
      ok: false,
      reason: 'tooLongToVerify',
    });
    // 上限 0 や負の数は 1 tick も進めない
    expect(verifyPlay(text, { maxTicks: 0 })).toEqual({ ok: false, reason: 'tooLongToVerify' });
    expect(verifyPlay(text, { maxTicks: -10 })).toEqual({ ok: false, reason: 'tooLongToVerify' });
    // 進める必要が無いプレイ（endTick 0）なら上限 0 でも通る
    const zero = encodePlay({ rulesVersion: SHARE_RULES_VERSION, seed: 1, inputs: [], endTick: 0 });
    const vz = verifyPlay(zero, { maxTicks: 0 });
    expect(vz.ok).toBe(true);
    if (vz.ok) expect(vz.result.ticks).toBe(0);
  }, 120_000);

  it('おかしい上限の値は「上限なし」として扱い、例外も出ない', () => {
    const auto = createAutoPlay(9);
    for (let i = 0; i < 240; i++) auto.step();
    const snap = auto.sim.getSnapshot();
    const text = encodePlay({
      rulesVersion: SHARE_RULES_VERSION,
      seed: 9,
      inputs: auto.sim.getInputLog(),
      endTick: snap.tick,
    });
    const full = verifyPlay(text);
    expect(full.ok).toBe(true);
    for (const opt of [
      undefined,
      {},
      { maxTicks: Number.NaN },
      { maxTicks: Infinity },
      { maxTicks: 'x' as unknown as number },
      null as unknown as VerifyOptions,
      42 as unknown as VerifyOptions,
    ]) {
      const v = verifyPlay(text, opt);
      expect(v.ok).toBe(true);
      if (v.ok && full.ok) expect(v.result).toEqual(full.result);
    }
  }, 120_000);
});
