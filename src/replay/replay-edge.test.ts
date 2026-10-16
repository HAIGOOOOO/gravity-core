// replay.test.ts が「正しい使い方」を見るのに対し、こちらは
// 端・壊れた記録・想定外の呼び方を確かめる。

import { describe, expect, it } from 'vitest';
import type { Tier } from '../contracts/game';
import { TICK_HZ } from '../game/constants';
import { at, createAutoPlay, dropAt } from '../fixtures/index';
import { createSimulation, type SimulationSetup } from '../game/simulation';
import { createReplayPlayer } from './player';
import { createReplayRecord, parseReplay, serializeReplay, type ReplayRecord } from './record';
import { launchAnyhow, recordAutoPlay, recordSetup, UP } from './testkit';

describe('記録の端と抜け', () => {
  it('tick 0・入力 0 件の記録を再生できる', () => {
    const record = createReplayRecord(createSimulation(8));
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const p = start.player;
    expect(p.endTick).toBe(0);
    expect(p.durationSeconds).toBe(0);
    expect(p.tick).toBe(0);
    expect(p.snapshot().tick).toBe(0);
    expect(p.seek(500).tick).toBe(0); // 範囲外は endTick に収まる
    expect(p.seek(-10).tick).toBe(0);
    expect(p.step(10).tick).toBe(0);
    expect(p.events).toHaveLength(0);
    expect(p.snapshot().bodies).toHaveLength(1); // 開始の 1 体だけ
  });

  it('記録の直前に撃たれた入力（tick = endTick）も最終盤面に出る', () => {
    const sim = createSimulation(3);
    sim.stepFixed();
    expect(sim.submitLaunch(dropAt(UP)).accepted).toBe(true);
    const record = createReplayRecord(sim); // 撃って 1 回も進めずに記録
    expect(record.endTick).toBe(1);
    expect(record.inputs).toHaveLength(1);
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    // 撃った天体が最終盤面にいる（開始の 1 体 + 射出 = 2 体）
    expect(start.player.seek(record.endTick).bodies).toHaveLength(2);
  });

  it('範囲外・小数・NaN の tick は決まった場所へ収まる', { timeout: 30_000 }, () => {
    const { record } = recordAutoPlay(12, 1_200);
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const p = start.player;
    expect(p.seek(-50).tick).toBe(0);
    expect(p.seek(record.endTick + 9_999).tick).toBe(record.endTick);
    expect(p.seek(Number.POSITIVE_INFINITY).tick).toBe(record.endTick);
    // NaN は飛べないので、いまの位置（endTick）に留まる
    expect(p.seek(Number.NaN).tick).toBe(record.endTick);
    expect(p.tick).toBe(record.endTick);
    expect(p.step(-100_000).tick).toBe(0);
    expect(p.step(100_000).tick).toBe(record.endTick);
    if (record.endTick >= 62) expect(p.seek(61.9).tick).toBe(61); // 小数は切り捨て
    expect(p.tick).not.toBeNaN();
  });

  it('終了した記録も再生でき、最後の盤面は over のまま', { timeout: 30_000 }, () => {
    const hot: SimulationSetup = {
      bodies: [at(7, 130, 0), at(6, 280, 0), at(5, 400, 0)],
      heat: 96,
      bestTier: 8 as Tier,
    };
    const record = recordSetup(1, hot, 10 * TICK_HZ);
    expect(record.phase).toBe('over');
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.player.seek(record.endTick).phase).toBe('over');
  });
});

describe('記録が合わないとき（続き）', () => {
  it('入力の tick 順が壊れている・記録を越える入力・統計の改ざんを検出する', { timeout: 30_000 }, () => {
    const sim = createSimulation(14);
    expect(launchAnyhow(sim, UP)).toBe(true);
    for (let i = 0; i < 90; i++) sim.stepFixed();
    expect(launchAnyhow(sim, UP + 0.9)).toBe(true);
    for (let i = 0; i < 60; i++) sim.stepFixed();
    const record = createReplayRecord(sim);
    expect(record.inputs.length).toBeGreaterThanOrEqual(2);
    expect(record.inputs[0]!.tick).toBeLessThan(record.inputs[1]!.tick);

    // 入力の順序を入れ替える → 再計算で受理できず「合わない」
    const swapped: ReplayRecord = {
      ...record,
      inputs: [record.inputs[1]!, record.inputs[0]!, ...record.inputs.slice(2)],
    };
    const r1 = createReplayPlayer(swapped);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toBe('diverged');

    // 記録を越える未来の入力 → 使われない入力として「合わない」
    const extra: ReplayRecord = {
      ...record,
      inputs: [...record.inputs, { tick: record.endTick + 500, originAngleRadians: 0, vx: 0, vy: -260 }],
    };
    const r2 = createReplayPlayer(extra);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe('diverged');

    // 同じ tick に同じ入力を重ねる → 2 回目は冷却で受理されず「合わない」
    const dup: ReplayRecord = { ...record, inputs: [record.inputs[0]!, ...record.inputs] };
    expect(createReplayPlayer(dup).ok).toBe(false);

    // 統計だけ書き換える → 「合わない」
    const stat: ReplayRecord = { ...record, stats: { ...record.stats, merges: record.stats.merges + 1 } };
    expect(createReplayPlayer(stat).ok).toBe(false);
  });
});

describe('記録の文字列化（続き）', () => {
  it('setup 付きの記録も文字列にして往復し、再生できる', { timeout: 30_000 }, () => {
    const setup: SimulationSetup = {
      bodies: [at(3, 200, 0.3), { tier: 5, x: -150, y: 200, vx: 40, vy: -20 }],
      heat: 30,
      queue: [2, 4, 6],
      bestTier: 5,
    };
    const record = recordSetup(9, setup, 900);
    const back = parseReplay(serializeReplay(record));
    expect(back).not.toBeNull();
    if (!back) return;
    expect(back).toEqual(record);
    const start = createReplayPlayer(back);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const snap = start.player.seek(record.endTick);
    expect(snap.score).toBe(record.finalScore);
    expect(snap.bodies).toHaveLength(record.finalBodyCount);
  });

  it('形は合うが中身の壊れた記録は読み戻さない', { timeout: 30_000 }, () => {
    const { record } = recordAutoPlay(9, 600);
    const bads: unknown[] = [
      { ...record, setup: { queue: [0, 1] } }, // queue は 3 つ
      { ...record, setup: { bodies: [{ tier: 9, x: 0, y: 0 }] } }, // Tier の範囲外
      { ...record, setup: { bodies: [{ tier: 0, x: 'x', y: 0 }] } },
      { ...record, inputs: [{ tick: -1, originAngleRadians: 0, vx: 0, vy: -260 }] },
      { ...record, inputs: [{ tick: 1.5, originAngleRadians: 0, vx: 0, vy: -260 }] },
      { ...record, inputs: [{ tick: 0, originAngleRadians: 0, vx: 0 }] }, // vy 欠損
      { ...record, endTick: 1.5 },
      { ...record, stats: { launches: 1, merges: 0, supernovas: 0 } }, // maxChain 欠損
    ];
    for (const b of bads) {
      expect(parseReplay(JSON.stringify(b)), JSON.stringify(b)).toBeNull();
    }
  });

  it('渡した setup をあとで書き換えても、記録は影響されない', () => {
    const setup: SimulationSetup = { bodies: [at(2, 200, 0)], heat: 10 };
    const record = createReplayRecord(createSimulation(5, setup), { setup });
    // 呼び出し側が中身を書き換える（実害: 再生時に違う開始状態になってしまう）
    setup.heat = 99;
    setup.bodies![0]!.x = 9_999;
    expect(record.setup?.heat).toBe(10);
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
  });
});

describe('出来事・peek・複数プレイヤー', () => {
  it('後ろ向きに飛んだ時も、越えた区間に起きた出来事が返る', { timeout: 30_000 }, () => {
    const sim = createSimulation(3);
    sim.submitLaunch(dropAt(UP)); // 合体が起きる配置
    for (let i = 0; i < 360; i++) sim.stepFixed();
    const record = createReplayRecord(sim);
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const p = start.player;
    p.seek(record.endTick);
    p.seek(0); // 末尾から先頭へ戻る = 全区間を越える
    expect(p.events.some((e) => e.kind === 'merge')).toBe(true);
  });

  it('peek は近いキーフレームを返し、いまの位置と出来事を動かさない', { timeout: 30_000 }, () => {
    const { record } = recordAutoPlay(15, 1_200);
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const p = start.player;
    const base = Math.min(600, Math.max(0, record.endTick - 1));
    p.seek(base);
    const before = p.events;
    const t = Math.min(record.endTick, base + 33);
    const snap = p.peek(t);
    // tick 以下の一番近いキーフレーム（60 tick ごと）
    expect(snap.tick).toBe(Math.floor(t / 60) * 60);
    expect(p.tick).toBe(base); // いまの位置は動かない
    expect(p.snapshot().tick).toBe(base);
    expect(p.events).toBe(before);
    // 範囲外・壊れた値を渡しても、決まったキーフレームを返す（落ちない）
    expect(p.peek(-5).tick).toBe(0);
    expect(p.peek(Number.POSITIVE_INFINITY).tick).toBe(Math.floor(record.endTick / 60) * 60);
    expect(p.peek(Number.NaN).tick).toBe(Math.floor(base / 60) * 60); // NaN はいまの位置
  });

  it('2 つのプレイヤーは別々の記録を独立に再生する', { timeout: 60_000 }, () => {
    const r1 = recordAutoPlay(31, 900);
    const r2 = recordAutoPlay(32, 900);
    const s1 = createReplayPlayer(r1.record);
    const s2 = createReplayPlayer(r2.record);
    expect(s1.ok && s2.ok).toBe(true);
    if (!s1.ok || !s2.ok) return;
    s1.player.seek(Math.min(300, r1.record.endTick));
    s2.player.seek(Math.min(120, r2.record.endTick));
    // 間に別のプレイヤーの seek を挟んでも、1 つ目は正しい盤面を返す
    const t = Math.min(450, r1.record.endTick);
    const got = s1.player.seek(t);
    const auto = createAutoPlay(31);
    let snap = auto.sim.getSnapshot();
    for (let i = 0; i < t && snap.phase === 'active'; i++) {
      auto.step();
      snap = auto.sim.getSnapshot();
    }
    expect(JSON.stringify(got)).toBe(JSON.stringify(snap));
  });
});
