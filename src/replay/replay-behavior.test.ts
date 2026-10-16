// replay.test.ts / replay-edge.test.ts で確かめていない
// 「API の約束事」に関する振る舞いを固める。
// - 記録は作った瞬間の状態で凍結される（あとで元の sim を進めても影響しない）
// - step / seek / events の細かい約束（同位置・小数・NaN・記録直前の入力）
// - runReplay: プレイヤーを作らず「合うか」だけ確かめる窓口
// - 静かな記録（射出はあるが合体も超新星も無い）と step(1) 順送りの速さ

import { describe, expect, it } from 'vitest';
import { TICK_HZ } from '../game/constants';
import { createAutoPlay, dropAt } from '../fixtures/index';
import { createSimulation } from '../game/simulation';
import { analyzeCause } from './cause';
import { CHECKPOINT_EVERY, runReplay } from './engine';
import { findHighlights } from './highlights';
import { createReplayPlayer } from './player';
import { createReplayRecord, snapshotHash, type ReplayRecord } from './record';
import { launchAnyhow, recordAutoPlay, UP } from './testkit';

describe('記録は作成時点で凍結される', () => {
  it('記録を作ったあと元のシミュレーションを進め続けても、記録は作った時点のまま再生できる', { timeout: 30_000 }, () => {
    const sim = createSimulation(51);
    for (let i = 0; i < 300; i++) sim.stepFixed();
    expect(launchAnyhow(sim, UP)).toBe(true);
    for (let i = 0; i < 120; i++) sim.stepFixed();
    const record = createReplayRecord(sim);
    const inputsAtRecord = record.inputs.length;
    const end = record.endTick;

    // 記録を作ったあとも、元のシミュレーションは別のプレイとして進め続ける。
    // getInputLog() は生きた配列を返すので、記録が参照を持ち回っていると
    // ここで inputs が増えてしまい、再生時に「合わない」になる。
    for (let i = 0; i < 500; i++) sim.stepFixed();
    expect(launchAnyhow(sim, UP + 1.1)).toBe(true);
    for (let i = 0; i < 200; i++) sim.stepFixed();
    expect(sim.getInputLog().length).toBeGreaterThan(inputsAtRecord); // 元のログは確かに育った

    expect(record.inputs).toHaveLength(inputsAtRecord);
    expect(record.endTick).toBe(end);
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(snapshotHash(start.player.seek(end))).toBe(record.finalHash);
  });

  it('プレイヤーは渡した記録をそのまま持つ（複製しない）', () => {
    const record = createReplayRecord(createSimulation(8));
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.player.record).toBe(record);
    expect(start.player.endTick).toBe(record.endTick);
  });
});

describe('位置と出来事の細かい約束', () => {
  it('同じ tick への再 seek は区間ゼロなので出来事は空になる', { timeout: 30_000 }, () => {
    const sim = createSimulation(3);
    sim.submitLaunch(dropAt(UP));
    for (let i = 0; i < 360; i++) sim.stepFixed();
    const record = createReplayRecord(sim);
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const p = start.player;
    p.seek(0);
    p.step(1); // launch イベントが返る
    expect(p.events.length).toBeGreaterThan(0);
    p.seek(p.tick); // 区間 (t, t] は空
    expect(p.events).toHaveLength(0);
  });

  it('step の小数は切り捨て、NaN は動かない', { timeout: 30_000 }, () => {
    const { record } = recordAutoPlay(53, 900);
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const p = start.player;
    const base = Math.min(300, record.endTick);
    p.seek(base);
    expect(p.step(0.9).tick).toBe(base); // floor(0.9) = 0 で動かない
    const forward = p.step(1.9).tick;
    expect(forward).toBe(Math.min(record.endTick, base + 1)); // floor(1.9) = 1
    if (forward >= 1) expect(p.step(-0.4).tick).toBe(forward - 1); // floor(-0.4) = -1
    const before = p.tick;
    expect(p.step(Number.NaN).tick).toBe(before); // NaN は「飛べない」ので留まる
  });

  it('seek していない最初の盤面は tick 0 の真値と一致し、再生時間は endTick から求まる', { timeout: 30_000 }, () => {
    const { record } = recordAutoPlay(55, 600);
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const p = start.player;
    expect(p.tick).toBe(0);
    expect(p.snapshot().tick).toBe(0);
    // 初期表示は「検証で取った tick 0 の盤面」。本物の tick 0 と一致する
    expect(JSON.stringify(p.snapshot())).toBe(JSON.stringify(createAutoPlay(55).sim.getSnapshot()));
    expect(p.durationSeconds).toBe(record.endTick / TICK_HZ);
    expect(p.events).toHaveLength(0);
  });

  it('記録直前に撃たれた入力は最終盤面に出るが、そのイベントはどの区間にも無い', () => {
    const sim = createSimulation(3);
    sim.stepFixed();
    expect(sim.submitLaunch(dropAt(UP)).accepted).toBe(true);
    const record = createReplayRecord(sim); // endTick 1、入力は tick 1 に 1 件
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const p = start.player;
    // 撃った天体は最終盤面にいる（開始の 1 体 + 射出 = 2 体）
    expect(p.seek(record.endTick).bodies).toHaveLength(2);
    // launch イベントが stepFixed から返るのは「撃った次のステップ」。
    // 記録にはそのステップが無いので、「通った区間の出来事」にも出ない
    expect(p.events).toHaveLength(0);
  });
});

describe('検証だけの窓口', () => {
  it('runReplay はプレイヤーを作らず「合うか」と出来事・終端の盤面を返す', { timeout: 30_000 }, () => {
    const { record } = recordAutoPlay(63, 900);
    const run = runReplay(record);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.final.tick).toBe(record.endTick);
    expect(run.checkpoints[0]!.tick).toBe(0);
    expect(run.checkpointEvery).toBe(CHECKPOINT_EVERY);
    // 出来事は返った順（at の昇順）に並んでいる
    const ats = run.events.map((e) => e.at);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    // 盤面を取らない設定では、先頭（tick 0）の 1 面だけを持つ
    const lean = runReplay(record, { checkpointEvery: 0 });
    expect(lean.ok).toBe(true);
    if (!lean.ok) return;
    expect(lean.checkpoints.map((s) => s.tick)).toEqual([0]);
    expect(lean.checkpointEvery).toBe(0);
  });

  it('visit は tick 0（出来事なし）から endTick まで毎 tick 順に呼ばれ、surfaced の合計は出来事の数と一致する', { timeout: 30_000 }, () => {
    const { record } = recordAutoPlay(71, 300);
    const ticks: number[] = [];
    let surfacedTotal = 0;
    const run = runReplay(record, {
      checkpointEvery: 0,
      visit: (snap, surfaced) => {
        ticks.push(snap.tick);
        surfacedTotal += surfaced.length;
      },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    // 0,1,…,endTick が抜けなく順に来る（最後の盤面で endTick の入力を反映した状態は呼ばれない）
    expect(ticks).toEqual([...Array(record.endTick + 1).keys()]);
    // visit に渡された出来事の総数は、集めた出来事の総数と一致する（取りこぼし・二重計上なし）
    expect(surfacedTotal).toBe(run.events.length);
  });

  it('runReplay も版の違う記録を rulesMismatch で止める', { timeout: 30_000 }, () => {
    const { record } = recordAutoPlay(64, 300);
    const wrong: ReplayRecord = { ...record, rulesVersion: 'r0.00000000' };
    const run = runReplay(wrong);
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.reason).toBe('rulesMismatch');
  });
});

describe('静かな記録と 2 つのプレイヤー', () => {
  it('射出はあるが合体も超新星も無い記録には、見どころが無い', { timeout: 30_000 }, () => {
    const sim = createSimulation(19);
    expect(launchAnyhow(sim, Math.PI / 2)).toBe(true); // 真下へ落とす（開始天体は真上。届かない）
    for (let i = 0; i < 300; i++) sim.stepFixed();
    const record = createReplayRecord(sim);
    expect(record.stats.launches).toBeGreaterThan(0); // 前提: 1 射はしている
    expect(record.stats.merges).toBe(0); // 前提: 1 度も合体していない
    const h = findHighlights(record);
    expect(h.ok).toBe(true);
    if (h.ok) expect(h.highlights).toHaveLength(0);
  });

  it('書き換えられた記録の見どころ・負けた理由は「合わない」を返す', { timeout: 30_000 }, () => {
    const { record } = recordAutoPlay(66, 600);
    const cheated: ReplayRecord = { ...record, finalScore: record.finalScore + 1_000 };
    const h = findHighlights(cheated);
    expect(h.ok).toBe(false);
    if (!h.ok) expect(h.reason).toBe('diverged');
    expect(analyzeCause(cheated).ok).toBe(false);
  });

  it('同じ記録の 2 つのプレイヤーは、互いの seek に影響しない', { timeout: 30_000 }, () => {
    const { record } = recordAutoPlay(37, 900);
    const a = createReplayPlayer(record);
    const b = createReplayPlayer(record);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    a.player.seek(Math.min(700, record.endTick));
    b.player.seek(Math.min(100, record.endTick));
    // 間に相手の seek を挟んでも、同じ tick には同じ盤面が返る
    const t = Math.min(450, record.endTick);
    expect(JSON.stringify(a.player.seek(t))).toBe(JSON.stringify(b.player.seek(t)));
  });
});

describe('進め方の速さ（1 コマずつ）', () => {
  it('step(1) の順送りは巻き戻し計算を伴わず、1 コマあたりの計算だけで済む', { timeout: 60_000 }, () => {
    const { record } = recordAutoPlay(61, 3_600);
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const p = start.player;
    const limit = Math.min(record.endTick, 1_200);
    expect(limit).toBeGreaterThan(0);
    const began = Date.now();
    for (let t = 0; t < limit; t++) p.step(1);
    const elapsed = Date.now() - began;
    expect(p.tick).toBe(limit);
    // 順送りのたびに tick 0 から計算し直す設計だと、これの数十〜数百倍かかる
    expect(elapsed).toBeLessThan(3_000);
  });
});
