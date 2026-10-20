// つまみ表示（peek）の粒度と、前後に飛んだ時の約束を固める。
// - peek は「t にちょうどの記憶面（間隔の倍数・終端・行った所）があればそれ、
//   なければ t 以下で一番近いキーフレーム」を即返す。
//   終端はキーフレーム間隔の倍数でなくても正確な盤面が返る。
// - 後ろ向きの seek でも、越えた区間の出来事は順向きと同じ並びで返る。
// - runReplay の「終端の中間面（入力反映前）と final（入力反映後）」の
//   違いを固定する（同じ tick の別物なので、混ぜると終端の 1 射が消える）。

import { describe, expect, it } from 'vitest';
import { at, dropAt } from '../fixtures/index';
import { createSimulation } from '../game/simulation';
import { runReplay } from './engine';
import { createReplayPlayer } from './player';
import { createReplayRecord, snapshotHash } from './record';
import { recordAutoPlay, recordSetup, UP } from './testkit';

describe('peek の粒度', () => {
  it('終端はキーフレーム間隔の倍数でなくても、peek は記録の最後の盤面そのものを返す', () => {
    // 合体も終了もしない静かな盤面で、endTick を 1250（60 の倍数ではない）に固定する
    const record = recordSetup(3, { bodies: [at(0, 200, 0)] }, 1_250);
    expect(record.endTick).toBe(1_250);
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const p = start.player;
    // 終端の面は常に覚えているので、1250 以下の一番近い倍数（1200）ではなく
    // 記録の最後の盤面そのものが返る。つまみを一番右へ持って行った時に
    // 「記録と違う 1 間隔前の絵」が出ないため。
    const snap = p.peek(record.endTick);
    expect(snap.tick).toBe(record.endTick);
    expect(snapshotHash(snap)).toBe(record.finalHash);
    // 範囲の先を渡しても終端に収まる
    expect(p.peek(record.endTick + 500).tick).toBe(record.endTick);
    // 終端ではない場所は、これまでどおり「以下で一番近いキーフレーム」
    expect(p.peek(record.endTick - 1).tick).toBe(1_200);
  });

  it('キーフレームが立つ tick では、peek と seek が同じ盤面オブジェクトを返す', { timeout: 30_000 }, () => {
    const { record } = recordAutoPlay(45, 1_800);
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const p = start.player;
    const k = Math.min(660, Math.floor(record.endTick / 60) * 60);
    expect(k).toBeGreaterThan(0);
    // 記憶している面は複製せず同じ 1 面を指す（peek で別物が返ると
    // つまみを離した瞬間に絵がわずかに跳ぶ）
    expect(p.peek(k)).toBe(p.seek(k));
    expect(p.peek(0)).toBe(p.seek(0));
  });

  it('一度止まった場所への peek は、キーフレームではなくその tick ちょうどの盤面を返す', { timeout: 30_000 }, () => {
    const { record } = recordAutoPlay(46, 1_200);
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const p = start.player;
    // キーフレーム間隔（60）に乗らない場所を選ぶ
    const t0 = Math.min(637, record.endTick - 1);
    const t = t0 % 60 === 0 ? t0 - 1 : t0;
    if (t < 1) return;
    expect(t % 60).not.toBe(0);
    const exact = p.seek(t); // 「行った所」の記憶に入る
    p.seek(Math.max(0, t - 300)); // いったん別の場所へ動かす
    // つまみが t をなぞった時に、手前のキーフレームではなく止まった盤面そのものが出る
    expect(p.peek(t)).toBe(exact);
    expect(p.peek(t).tick).toBe(t);
  });

  it('peek は位置・出来事・覚えている量を変えない', { timeout: 30_000 }, () => {
    const { record } = recordAutoPlay(15, 1_200);
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const p = start.player;
    p.seek(Math.min(500, record.endTick));
    const tickBefore = p.tick;
    const eventsBefore = p.events;
    const memBefore = p.memory;
    for (const f of [0.1, 0.5, 0.9, 0, 1]) p.peek(Math.floor(record.endTick * f));
    expect(p.tick).toBe(tickBefore);
    expect(p.events).toBe(eventsBefore);
    expect(p.memory).toEqual(memBefore);
  });
});

describe('前後に飛んだ時の出来事', () => {
  it('後ろ向きの seek でも、越えた区間の出来事は順向きと同じ並び（発生順）で返る', { timeout: 30_000 }, () => {
    const { record } = recordAutoPlay(37, 900);
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    // 出来事の正解は、独立に計算した runReplay の索引から取る
    const run = runReplay(record, { checkpointEvery: 0 });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const p = start.player;
    const a = Math.floor(record.endTick * 0.2);
    const b = Math.floor(record.endTick * 0.8);
    const want = run.events
      .filter((e) => e.at > a && e.at <= b)
      .map((e) => JSON.stringify(e.event));

    p.seek(a);
    expect(p.seek(b).tick).toBe(b);
    expect(p.events.map((e) => JSON.stringify(e))).toEqual(want); // 順向き (a, b]

    expect(p.seek(a).tick).toBe(a);
    expect(p.events.map((e) => JSON.stringify(e))).toEqual(want); // 逆向きも同じ区間・同じ並び
    const seqs = p.events.map((e) => e.sequence);
    expect([...seqs].sort((x, y) => x - y)).toEqual(seqs); // 発生順で固定
  });

  it('同じ tick への再 seek は同じ盤面オブジェクトを返し、step(0) は出来事を空にする', { timeout: 30_000 }, () => {
    const { record } = recordAutoPlay(44, 900);
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const p = start.player;
    const t = Math.min(701, record.endTick);
    const first = p.seek(t);
    expect(p.seek(t)).toBe(first); // 記憶済みなら同じオブジェクトが返る
    expect(p.events).toHaveLength(0); // 区間ゼロ
    const moved = p.step(1).tick;
    expect(moved).toBe(Math.min(t + 1, record.endTick));
    p.step(0); // 区間ゼロに戻る
    expect(p.tick).toBe(moved);
    expect(p.events).toHaveLength(0);
  });
});

describe('runReplay の中間面と最終盤面', () => {
  it('終端に入力がある記録では、終端の中間面は入力前・final は入力後の盤面', () => {
    const sim = createSimulation(3);
    for (let i = 0; i < 60; i++) sim.stepFixed();
    expect(sim.submitLaunch(dropAt(UP)).accepted).toBe(true);
    const record = createReplayRecord(sim); // endTick 60・入力は tick 60 に 1 件
    const run = runReplay(record, { checkpointEvery: 60 });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.checkpoints.map((s) => s.tick)).toEqual([0, 60]);
    // 同じ tick 60 でも、中間面は入力反映前（1 体）・final は反映後（2 体）。
    // 終端の基準に中間面を使うと、記録直前の 1 射が消えた盤面が出てしまう。
    const lastCp = run.checkpoints[run.checkpoints.length - 1]!;
    expect(lastCp.bodies).toHaveLength(1);
    expect(run.final.bodies).toHaveLength(2);
    expect(snapshotHash(run.final)).toBe(record.finalHash);
  });

  it('出来事の at は「その出来事が返った tick」。launch だけ 1 つ後で返る', { timeout: 30_000 }, () => {
    // 自動プレイではなく手で撃つので、launch イベントが必ず存在する
    const sim = createSimulation(3);
    expect(sim.submitLaunch(dropAt(UP)).accepted).toBe(true);
    for (let i = 0; i < 360; i++) sim.stepFixed();
    const record = createReplayRecord(sim);
    const run = runReplay(record, { checkpointEvery: 0 });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.events.some((e) => e.event.kind === 'launch')).toBe(true);
    for (const e of run.events) {
      // launch は撃った直後の stepFixed で返るので at = event.tick + 1、
      // ほかの出来事は起きた tick で返る（at = event.tick）
      const want = e.event.kind === 'launch' ? e.event.tick + 1 : e.event.tick;
      expect(e.at, `${e.event.kind}@${e.event.tick}`).toBe(want);
    }
  });
});
