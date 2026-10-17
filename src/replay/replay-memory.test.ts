// プレイヤーが覚える物の量（メモリ）の計測と、
// キーフレームがまばらでも盤面が正確に返ることの確認。
// 実際に 2 時間の記録を作るのは重いので、keyframeCap を絞って
// 「長い記録と同じまばらさ」を短い記録で再現する。

import { describe, expect, it } from 'vitest';
import { TICK_HZ } from '../game/constants';
import { at } from '../fixtures/index';
import { createReplayPlayer, keyframeInterval } from './player';
import { recordAutoPlay, recordSetup, snapshotJsonAt } from './testkit';

describe('キーフレーム間隔', () => {
  it('短い記録は 60 tick ごと、長い記録は面数が上限に収まる間隔へ広がる', () => {
    expect(keyframeInterval(0)).toBe(60);
    expect(keyframeInterval(7_200)).toBe(60); // 1 分
    expect(keyframeInterval(43_200)).toBe(60); // 6 分ちょうど → 720 面
    expect(keyframeInterval(43_201)).toBe(61); // 越えると 1 段広がる
    expect(keyframeInterval(TICK_HZ * 7_200)).toBe(1_200); // 2 時間 → 720 面
    // cap を小さく渡すと短い記録でも「長い記録のまばらさ」を再現できる
    expect(keyframeInterval(1_200, 4)).toBe(300);
    // 0 以下の cap は壊れた間隔（Infinity）にならない
    expect(keyframeInterval(1_200, 0)).toBe(1_200);
  });
});

describe('覚える物の量', () => {
  it('キーフレームがまばらでも（長い記録と同じ条件）、任意 tick の盤面は正確', { timeout: 60_000 }, () => {
    const { record } = recordAutoPlay(44, 1_800);
    const cap = 6;
    const start = createReplayPlayer(record, { keyframeCap: cap });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const p = start.player;
    // キーフレームの面数が cap 程度に収まっている（倍数 + 終端で +2 まで）
    expect(p.memory.keyframes).toBeLessThanOrEqual(cap + 2);
    // キーフレームに当たらない tick も含めて、飛んだ先の盤面は真値と一致する
    for (const t of [0, 37, 150, 901, 1_500, record.endTick]) {
      if (t > record.endTick) continue;
      const want = snapshotJsonAt(44, t);
      if (want === undefined) continue;
      expect(JSON.stringify(p.seek(t)), `tick ${t}`).toBe(want);
    }
    const every = keyframeInterval(record.endTick, cap);
    if (record.endTick >= 950) {
      // まばらな間隔でも、行っていない場所への peek は「t 以下の一番近いキーフレーム」
      expect(p.peek(950).tick).toBe(Math.floor(950 / every) * every);
      // 行った所（901）への peek は、キーフレームではなくその tick ちょうどの盤面
      expect(p.peek(901).tick).toBe(901);
    }
  });

  it('行った所の記憶は 240 面で止まり、古い物が捨てられても再 seek は正しい', { timeout: 60_000 }, () => {
    const { record } = recordAutoPlay(45, 3_600);
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const p = start.player;
    // キーフレーム（60 の倍数）を避けた連番へ順に飛ぶ → 「行った所」が育つ
    const limit = Math.min(record.endTick - 1, 312);
    const targets: number[] = [];
    for (let t = 1; t <= limit; t++) if (t % 60 !== 0) targets.push(t);
    for (const t of targets) expect(p.seek(t).tick).toBe(t);
    // 上限 240 を越えた分は古い物から捨てられる。増え続けないことが大事
    expect(p.memory.visited).toBe(Math.min(240, targets.length));
    expect(p.memory.cursors).toBeLessThanOrEqual(4);
    // 捨てられたはずの最初の場所へもう一度飛んでも、盤面は正確に再現される
    // （記録が短すぎて targets が無い異例では、ここだけ何も確かめない）
    if (targets.length > 0) {
      const want = snapshotJsonAt(45, targets[0]!);
      if (want !== undefined) expect(JSON.stringify(p.seek(targets[0]!))).toBe(want);
    }
  });

  it('memory が内訳と概算サイズを返し、cap を絞ると覚える量が減る', { timeout: 60_000 }, () => {
    // 途中で終わらない静かな盤面で 1800 tick の記録を作り、endTick を確定させる
    const record = recordSetup(46, { bodies: [at(0, 200, 0)] }, 1_800);
    expect(record.endTick).toBe(1_800);
    const start = createReplayPlayer(record);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const m = start.player.memory;
    // キーフレーム: 0,60,…,endTick 以下の倍数ちょうど + 端数なら終端の 1 面
    const wantKeys = Math.floor(record.endTick / 60) + 1 + (record.endTick % 60 === 0 ? 0 : 1);
    expect(m.keyframes).toBe(wantKeys);
    expect(m.visited).toBe(0); // まだどこにも飛んでいない
    expect(m.cursors).toBe(0);
    expect(m.events).toBeGreaterThanOrEqual(0);
    // 数十秒ぶんの記録なら数 MB に余裕で収まる（異常な溜め込みの退行検知）
    expect(m.approxBytes).toBeGreaterThan(0);
    expect(m.approxBytes).toBeLessThan(4 * 1024 * 1024);
    // 同じ記録で cap を絞ると、覚える盤面の分だけ軽くなる
    const lean = createReplayPlayer(record, { keyframeCap: 8 });
    expect(lean.ok).toBe(true);
    if (!lean.ok) return;
    expect(lean.player.memory.keyframes).toBeLessThanOrEqual(10);
    expect(lean.player.memory.approxBytes).toBeLessThan(m.approxBytes);
  });
});
