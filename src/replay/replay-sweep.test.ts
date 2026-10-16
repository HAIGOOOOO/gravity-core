// replay.test.ts / replay-edge.test.ts の間を埋める「細かい一致」の確認。
// 1 コマずつ最後まで照合する通しテストと、記録の項目を 1 つずつ壊すテストが主。

import { describe, expect, it } from 'vitest';
import type { Tier } from '../contracts/game';
import { TICK_HZ } from '../game/constants';
import { at, createAutoPlay } from '../fixtures/index';
import { createSimulation, type SimulationSetup } from '../game/simulation';
import { findHighlights } from './highlights';
import { createReplayPlayer } from './player';
import {
  createReplayRecord,
  parseReplay,
  REPLAY_FORMAT,
  rulesVersion,
  serializeReplay,
  type ReplayRecord,
} from './record';
import { recordAutoPlay, recordSetup } from './testkit';

describe('1 コマずつの通し再生', () => {
  it('step(1) で進めた盤面と出来事が、全 tick で元と一致する', { timeout: 60_000 }, () => {
    const auto = createAutoPlay(23);
    const truthSnaps = new Map<number, string>();
    const truthEvents = new Map<number, string[]>();
    const maxTicks = 900;
    for (let i = 0; i <= maxTicks; i++) {
      const snap = auto.sim.getSnapshot();
      truthSnaps.set(snap.tick, JSON.stringify(snap));
      if (snap.tick >= maxTicks || snap.phase === 'over') break;
      truthEvents.set(snap.tick + 1, auto.step().map((e) => JSON.stringify(e)));
    }
    const record = createReplayRecord(auto.sim);
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const p = start.player;
    p.seek(0);
    for (let t = 1; t <= record.endTick; t++) {
      const snap = p.step(1);
      expect(JSON.stringify(snap), `盤面 tick ${t}`).toBe(truthSnaps.get(t));
      // そのコマで返った出来事（射出・着地・合体…）も 1 つも違わない
      const want = truthEvents.get(t) ?? [];
      expect(p.events.map((e) => JSON.stringify(e)), `出来事 tick ${t}`).toEqual(want);
    }
    // 「行った所」の上限（240 面）を越えて古い面が捨てられたあとも、再 seek は正しい
    for (const t of [1, Math.floor(record.endTick / 2), record.endTick]) {
      const want = truthSnaps.get(t);
      if (want !== undefined) expect(JSON.stringify(p.seek(t)), `再 seek ${t}`).toBe(want);
    }
  });
});

describe('見どころ（続き）', () => {
  it('同じ tick の超新星も全部拾い、何回目かを付ける', { timeout: 30_000 }, () => {
    const nova4: SimulationSetup = {
      bodies: [at(8, 150, 0), at(8, 350, 0), at(8, 150, 2), at(8, 350, 2)],
      heat: 60,
      bestTier: 8 as Tier,
    };
    const record = recordSetup(1, nova4, 5);
    expect(record.stats.supernovas).toBe(2);
    const h = findHighlights(record);
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    const novas = h.highlights.filter((x) => x.kind === 'supernova');
    expect(novas.map((x) => x.value)).toEqual([1, 2]);
    for (const n of novas) expect(n.tick).toBe(1); // 置いた瞬間に接しているので最初のステップで弾ける
    // 返す順は tick 昇順
    const ticks = h.highlights.map((x) => x.tick);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
  });

  it('最高 Tier の誕生は「開始時点の最高」を越えた時だけ立つ', { timeout: 30_000 }, () => {
    // 開始時点で既に Tier 5 到達済みの記録。Tier 4 どうしの合体で Tier 5 が
    // 生まれても「そのプレイの最高が初めて生まれた」ではないので拾わない。
    // （距離 82 < 41+41+0.6 なので、置いた瞬間に接していて最初のステップで合体する）
    const flat: SimulationSetup = { bodies: [at(4, 150, 0), at(4, 232, 0)], bestTier: 5 };
    const r1 = recordSetup(1, flat, 60);
    expect(r1.stats.merges).toBe(1);
    const h1 = findHighlights(r1);
    expect(h1.ok).toBe(true);
    if (h1.ok) expect(h1.highlights.some((x) => x.kind === 'bestTier')).toBe(false);

    // Tier 5 どうしが合体して Tier 6 が生まれる = 開始時の最高を越えた → 拾う
    const over: SimulationSetup = { bodies: [at(5, 150, 0), at(5, 254, 0)], bestTier: 5 };
    const h2 = findHighlights(recordSetup(1, over, 60));
    expect(h2.ok).toBe(true);
    if (!h2.ok) return;
    const best = h2.highlights.find((x) => x.kind === 'bestTier');
    expect(best?.value).toBe(6);
    expect(best?.tick).toBe(1);
  });

  it('動きの無い記録には見どころが無く、生きている記録に beforeGameOver は無い', { timeout: 30_000 }, () => {
    const h = findHighlights(createReplayRecord(createSimulation(8)));
    expect(h.ok).toBe(true);
    if (h.ok) expect(h.highlights).toHaveLength(0);

    const { record } = recordAutoPlay(13, 600);
    expect(record.phase).toBe('active'); // 前提: まだ終わっていない記録
    const h2 = findHighlights(record);
    expect(h2.ok).toBe(true);
    if (!h2.ok) return;
    expect(h2.highlights.some((x) => x.kind === 'beforeGameOver')).toBe(false);
  });
});

describe('記録の形と改ざん', () => {
  it('format・createdAt・rulesVersion は決まった形で安定している', () => {
    const v = rulesVersion();
    expect(v).toMatch(/^r\d+\.[0-9a-f]{8}$/);
    expect(rulesVersion()).toBe(v); // 呼ぶたびに同じ指紋
    const record = createReplayRecord(createSimulation(2), { now: new Date('2026-10-16T00:00:00Z') });
    expect(record.format).toBe(REPLAY_FORMAT);
    expect(record.createdAt).toBe('2026-10-16T00:00:00.000Z');
    // 既定では現在時刻。読める日時であることだけ確かめる
    expect(Number.isNaN(Date.parse(createReplayRecord(createSimulation(2)).createdAt))).toBe(false);
  });

  it('seed・setup・initialHash・finalHash のどれを変えても「合わない」になる', { timeout: 30_000 }, () => {
    const { record } = recordAutoPlay(6, 900);
    // 同じ入力でも seed が違えば盤面は違う
    const badSeed: ReplayRecord = { ...record, seed: record.seed + 1 };
    const r1 = createReplayPlayer(badSeed);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toBe('diverged');
    // 無かった開始状態を後から足す。
    // （開始時の熱量は途中で冷却されて最終盤面が同じになるので、finalHash では
    //   すり抜ける。開始の盤面の指紋 initialHash で止まる）
    const added: ReplayRecord = { ...record, setup: { heat: 50 } };
    expect(createReplayPlayer(added).ok).toBe(false);
    // 逆に setup 付きの記録から setup を抜いても、開始の盤面が違うので合わない
    const setupRecord = recordSetup(4, { heat: 30, bodies: [at(3, 200, 0.2)] }, 300);
    expect(createReplayPlayer({ ...setupRecord, setup: undefined }).ok).toBe(false);
    // 盤面の指紋だけを潰す（どんな細工も最後はここで止まる）
    const badHash: ReplayRecord = { ...record, finalHash: 'deadbeef' };
    const r3 = createReplayPlayer(badHash);
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.reason).toBe('diverged');
    // 開始の盤面の指紋だけを潰しても同じ
    const badInit: ReplayRecord = { ...record, initialHash: 'deadbeef' };
    expect(createReplayPlayer(badInit).ok).toBe(false);
  });

  it('文字列から読み戻した記録もそのまま再生でき、二度の変換で文字列がぶれない', { timeout: 30_000 }, () => {
    const { record, final } = recordAutoPlay(33, 600);
    const back = parseReplay(serializeReplay(record));
    expect(back).not.toBeNull();
    if (!back) return;
    const start = createReplayPlayer(back);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(JSON.stringify(start.player.seek(record.endTick))).toBe(JSON.stringify(final));
    expect(serializeReplay(back)).toBe(serializeReplay(record));
  });
});

describe('出来事の通し（続き）', () => {
  it('最初から最後まで飛ぶと、overLimitStart と gameOver が順に返る', { timeout: 30_000 }, () => {
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
    const p = start.player;
    p.seek(0);
    p.seek(record.endTick);
    const kinds = p.events.map((e) => e.kind);
    expect(kinds).toContain('overLimitStart');
    expect(kinds).toContain('gameOver');
    // gameOver は発生順として最後の出来事
    expect(kinds[kinds.length - 1]).toBe('gameOver');
  });
});
