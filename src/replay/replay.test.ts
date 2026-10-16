import { describe, expect, it } from 'vitest';
import type { Tier } from '../contracts/game';
import { CORE_RADIUS, TICK_HZ } from '../game/constants';
import { at, createAutoPlay, dropAt } from '../fixtures/index';
import { createSimulation, type SimulationSetup } from '../game/simulation';
import { analyzeCause } from './cause';
import { findHighlights } from './highlights';
import { createReplayPlayer } from './player';
import {
  createReplayRecord,
  parseReplay,
  rulesVersion,
  serializeReplay,
  type ReplayRecord,
} from './record';
import { recordAutoPlay, recordSetup, UP } from './testkit';

describe('記録と再生', () => {
  it(
    '自動プレイ 30 回ぶんを記録して再生すると、最後の得点と天体の数が元と一致する',
    { timeout: 120_000 },
    () => {
      for (let seed = 1; seed <= 30; seed++) {
        const { record, final } = recordAutoPlay(seed, 1_800);
        const start = createReplayPlayer(record);
        expect(start.ok, `seed ${seed}`).toBe(true);
        if (!start.ok) continue;
        const snap = start.player.seek(record.endTick);
        expect(snap.score).toBe(final.score);
        expect(snap.bodies).toHaveLength(final.bodies.length);
        // 得点と数だけでなく、盤面そのものが一致する
        expect(JSON.stringify(snap)).toBe(JSON.stringify(final));
      }
    },
  );

  it('seek で好きな tick に飛んだ盤面が、最初から順に進めた盤面と一致する', { timeout: 60_000 }, () => {
    const maxTicks = 3_000;
    const targets = [0, 1, 59, 60, 123, 777, 1_234, 2_000, 2_999];
    const auto = createAutoPlay(77);
    const truth = new Map<number, string>();
    for (let i = 0; i <= maxTicks; i++) {
      const snap = auto.sim.getSnapshot();
      if (targets.includes(snap.tick)) truth.set(snap.tick, JSON.stringify(snap));
      if (snap.tick >= maxTicks || snap.phase === 'over') break;
      auto.step();
    }
    const record = createReplayRecord(auto.sim);
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    // 前後に行ったり来たり、同じ所へ二度飛んでも一致する
    for (const t of [777, 1, 2_000, 0, 2_999, 60, 123, 1_234, 59, 777]) {
      const want = truth.get(t);
      if (want === undefined) continue; // 終了が早くてその tick が無い
      expect(JSON.stringify(start.player.seek(t)), `tick ${t}`).toBe(want);
    }
    // step で順に進めても一致する
    start.player.seek(0);
    if (truth.get(60) !== undefined) expect(JSON.stringify(start.player.step(60))).toBe(truth.get(60));
    if (truth.get(123) !== undefined) expect(JSON.stringify(start.player.step(63))).toBe(truth.get(123));
  });

  it('step で進めた区間に起きた出来事が events に返る', { timeout: 30_000 }, () => {
    const sim = createSimulation(3);
    sim.submitLaunch(dropAt(UP)); // tick 0 で真上へ落とす（最初の 1 射で合体する配置）
    for (let i = 0; i < 360; i++) sim.stepFixed();
    const record = createReplayRecord(sim);
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const p = start.player;
    p.seek(0);
    p.step(1); // launch は tick 1 のステップで返る
    expect(p.events.some((e) => e.kind === 'launch')).toBe(true);
    let merged = false;
    for (let i = 0; i < 360; i++) {
      if (p.step(1).tick >= record.endTick) break;
      if (p.events.some((e) => e.kind === 'merge')) merged = true;
    }
    expect(merged).toBe(true);
  });
});

describe('記録が合わないとき', () => {
  it('ルールの版が違う記録は、合わないと分かる結果を返す', { timeout: 30_000 }, () => {
    const { record } = recordAutoPlay(5, 600);
    const wrong: ReplayRecord = { ...record, rulesVersion: 'r0.00000000' };
    const start = createReplayPlayer(wrong);
    expect(start.ok).toBe(false);
    if (start.ok) return;
    expect(start.reason).toBe('rulesMismatch');
    if (start.reason === 'rulesMismatch') expect(start.expected).toBe(rulesVersion());
    // 再生以外（見どころ・負けた理由）も同じく「合わない」を返す
    expect(findHighlights(wrong).ok).toBe(false);
    expect(analyzeCause(wrong).ok).toBe(false);
  });

  it('記録を書き換えると、合わないと分かる結果を返す', { timeout: 30_000 }, () => {
    const { record } = recordAutoPlay(6, 1_200);
    expect(record.inputs.length).toBeGreaterThan(0);
    // 入力を 1 件抜く
    const dropped: ReplayRecord = { ...record, inputs: record.inputs.slice(1) };
    const bad = createReplayPlayer(dropped);
    expect(bad.ok).toBe(false);
    // 最後の得点を盛る
    const cheated: ReplayRecord = { ...record, finalScore: record.finalScore + 1_000 };
    expect(createReplayPlayer(cheated).ok).toBe(false);
    // 存在しない tick までの記録
    const long: ReplayRecord = { ...record, endTick: record.endTick + 10_000 };
    expect(createReplayPlayer(long).ok).toBe(false);
  });
});

describe('記録の文字列化', () => {
  it('文字列にして読み戻せる', { timeout: 30_000 }, () => {
    const { record } = recordAutoPlay(9, 600);
    expect(parseReplay(serializeReplay(record))).toEqual(record);
  });

  it('壊れた・形の違う文字列は null を返す', () => {
    for (const text of ['', 'not json', 'null', '[1,2]', '{"format":99}', '{"format":1}']) {
      expect(parseReplay(text), text).toBeNull();
    }
  });
});

describe('見どころ', () => {
  it('最大の連鎖と、最高 Tier が初めて生まれた瞬間を拾う', { timeout: 30_000 }, () => {
    // Tier 0+0 → Tier 1、それが隣の Tier 1 と合体 → Tier 2（連鎖 2）
    const setup: SimulationSetup = {
      bodies: [
        at(0, CORE_RADIUS + 14, UP),
        at(0, CORE_RADIUS + 42, UP),
        at(1, CORE_RADIUS + 19, UP + 0.58),
      ],
    };
    const record = recordSetup(1, setup, 3 * TICK_HZ);
    const h = findHighlights(record);
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    expect(h.highlights.find((x) => x.kind === 'maxChain')?.value).toBe(2);
    expect(h.highlights.find((x) => x.kind === 'bestTier')?.value).toBe(2);
    // 最高 Tier が生まれた tick は、2 回目の合体が返った tick と同じ
    const sim = createSimulation(1, setup);
    let merges = 0;
    let secondMerge = -1;
    for (let i = 0; i < 3 * TICK_HZ && merges < 2; i++) {
      for (const e of sim.stepFixed()) {
        if (e.kind === 'merge' && ++merges === 2) secondMerge = e.tick;
      }
    }
    expect(h.highlights.find((x) => x.kind === 'bestTier')?.tick).toBe(secondMerge);
  });

  it('超新星と、熱量が 75 を越えた瞬間と、ゲームオーバー 10 秒前を拾う', { timeout: 30_000 }, () => {
    const nova: SimulationSetup = { bodies: [at(8, 150, 0), at(8, 350, 0)], heat: 60, bestTier: 8 as Tier };
    const record = recordSetup(1, nova, 5);
    const h = findHighlights(record);
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    const novaTick = h.highlights.find((x) => x.kind === 'supernova');
    expect(novaTick?.tick).toBe(1); // 最初のステップで超新星になる

    const hot: SimulationSetup = {
      bodies: [at(7, 130, 0), at(6, 280, 0), at(5, 400, 0)],
      heat: 96,
      bestTier: 8 as Tier,
    };
    const dead = recordSetup(1, hot, 10 * TICK_HZ);
    expect(dead.phase).toBe('over');
    const h2 = findHighlights(dead);
    expect(h2.ok).toBe(true);
    if (!h2.ok) return;
    const crit = h2.highlights.find((x) => x.kind === 'heatCritical');
    expect(crit?.value).toBeGreaterThan(75); // value は境目ではなく越えた瞬間の実熱量
    const soon = h2.highlights.find((x) => x.kind === 'beforeGameOver');
    expect(soon).toBeDefined();
    // ゲームオーバーの 10 秒前（0 より前にはならない）
    expect(soon!.tick).toBe(Math.max(0, soon!.value - 10 * TICK_HZ));
  });
});

describe('負けた理由', () => {
  it('熱量が上がり始めた tick と、そのとき限界を越えていた天体を返す', { timeout: 30_000 }, () => {
    const setup: SimulationSetup = {
      bodies: [at(7, 130, 0), at(6, 280, 0), at(5, 400, 0)],
      heat: 96,
      bestTier: 8 as Tier,
    };
    const record = recordSetup(1, setup, 10 * TICK_HZ);
    const result = analyzeCause(record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cause = result.cause;
    expect(cause).not.toBeNull();
    if (!cause) return;
    // 別途シミュレーションを回して、正解を確かめる
    const sim = createSimulation(1, setup);
    let lastRise = -1;
    let over = -1;
    for (let i = 0; i < 10 * TICK_HZ && sim.getSnapshot().phase === 'active'; i++) {
      for (const e of sim.stepFixed()) {
        if (e.kind === 'overLimitStart') lastRise = e.tick;
        if (e.kind === 'gameOver') over = e.tick;
      }
    }
    expect(cause.heatRiseTick).toBe(lastRise);
    expect(cause.gameOverTick).toBe(over);
    expect(cause.snapshot.tick).toBe(lastRise);
    expect(cause.culprits.length).toBeGreaterThan(0);
    expect(cause.culprits.every((b) => b.overLimit)).toBe(true);
  });

  it('ゲームオーバーしていない記録には cause が無い', { timeout: 30_000 }, () => {
    const { record } = recordAutoPlay(11, 1_200);
    const result = analyzeCause(record);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cause).toBeNull();
  });
});

describe('seek の速さ', () => {
  it('3 分ぶんのプレイで、好きな tick への seek が十分速い', { timeout: 120_000 }, () => {
    const { record } = recordAutoPlay(2026, 3 * 60 * TICK_HZ);
    const buildBegan = Date.now();
    const start = createReplayPlayer(record);
    // 作成時の検証（最初から最後まで計算し直す）が退行していないかも見る
    expect(Date.now() - buildBegan).toBeLessThan(20_000);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const { player } = start;
    // ばらけた tick へ連続で飛ぶ（カーソルが育つ途中の、一番重い使い方）
    const fractions = [0.3, 0.85, 0.1, 0.6, 0.95, 0.45, 0.02, 0.7];
    let worst = 0;
    let total = 0;
    for (const f of fractions) {
      const began = Date.now();
      player.seek(Math.floor(record.endTick * f));
      const elapsed = Date.now() - began;
      worst = Math.max(worst, elapsed);
      total += elapsed;
    }
    expect(worst).toBeLessThan(5_000);
    // 1 回ごとの上限だけでは「じわじわ遅くなる」退行を逃すので、合計にも上限を付ける
    expect(total).toBeLessThan(15_000);
    // キーフレームちょうどへの seek は、行った事がなくてもキャッシュで即返る
    const keyframe = Math.floor(Math.min(record.endTick, 1_800) / 60) * 60;
    const kfBegan = Date.now();
    player.seek(keyframe);
    expect(Date.now() - kfBegan).toBeLessThan(200);
    // 同じ場所への再 seek はキャッシュで速い
    const began = Date.now();
    player.seek(Math.floor(record.endTick * 0.7));
    expect(Date.now() - began).toBeLessThan(200);
    // 一度行った所のすぐ手前は、育ったカーソルを少し戻すだけで済む
    const nearBegan = Date.now();
    player.seek(Math.floor(record.endTick * 0.7) - 7);
    expect(Date.now() - nearBegan).toBeLessThan(1_000);
    // つまみ表示用の peek は常に軽い
    const peekBegan = Date.now();
    player.peek(Math.floor(record.endTick * 0.33));
    expect(Date.now() - peekBegan).toBeLessThan(50);
  });
});
