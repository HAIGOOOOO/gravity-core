// 検証の上限（tooLong）。「記録と合うか」の確かめは endTick ぶん全部
// 計算し直すので、endTick がとても大きい記録は再計算が際限なく掛かる
// （終わらない盤面なら文字どおり永遠）。上限を越えた記録は、
// 計算を始める前に tooLong で止めることを確かめる。

import { describe, expect, it } from 'vitest';
import { at } from '../fixtures/index';
import { analyzeCause } from './cause';
import { MAX_REPLAY_TICKS, runReplay } from './engine';
import { findHighlights } from './highlights';
import { createReplayPlayer } from './player';
import type { ReplayRecord } from './record';
import { recordSetup } from './testkit';

/**
 * 合体も終了もしない静かな盤面の記録。
 * endTick を書き換えるだけで「どこまでも進む記録」が作れるので、
 * 上限のテストにはこれが一番重い入力になる。
 */
const quietRecord = (ticks: number): ReplayRecord =>
  recordSetup(64, { bodies: [at(0, 200, 0)] }, ticks);

describe('検証の上限（tooLong）', () => {
  it('endTick が上限を越える記録は、再計算を始める前に tooLong で止まる', () => {
    const huge: ReplayRecord = { ...quietRecord(60), endTick: MAX_REPLAY_TICKS + 1 };
    const began = Date.now();
    const run = runReplay(huge);
    const elapsed = Date.now() - began;
    expect(run.ok).toBe(false);
    if (run.ok) return;
    // 「合わない」(diverged) ではなく「長すぎる」: 記録自体は正しい可能性が
    // 残るので別の理由にしてあり、呼び出し側で区別できる
    expect(run.reason).toBe('tooLong');
    if (run.reason !== 'tooLong') return;
    expect(run.limit).toBe(MAX_REPLAY_TICKS);
    expect(run.endTick).toBe(MAX_REPLAY_TICKS + 1);
    // 盤面も作らずに止まるので、endTick がどれだけ大きくても一瞬で返る
    expect(elapsed).toBeLessThan(1_000);
  });

  it('プレイヤー・見どころ・負けた理由にも、そのまま tooLong が返る', () => {
    const huge: ReplayRecord = { ...quietRecord(60), endTick: MAX_REPLAY_TICKS * 4 };
    const began = Date.now();
    const start = createReplayPlayer(huge);
    const h = findHighlights(huge);
    const c = analyzeCause(huge);
    // 3 窓口とも再計算を始めない（始めていればこの数倍〜数十倍掛かる）
    expect(Date.now() - began).toBeLessThan(1_000);
    expect(start.ok).toBe(false);
    if (!start.ok) expect(start.reason).toBe('tooLong');
    expect(h.ok).toBe(false);
    if (!h.ok) expect(h.reason).toBe('tooLong');
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toBe('tooLong');
  });

  it('上限は options.maxTicks で変えられる。上限ちょうどの記録は通常どおり確かめられる', () => {
    const record = quietRecord(120);
    // 記録より 1 だけ小さい上限でも tooLong
    const small = runReplay(record, { maxTicks: record.endTick - 1 });
    expect(small.ok).toBe(false);
    if (!small.ok) expect(small.reason).toBe('tooLong');
    // 上限ちょうどは越えていないので、通常の検証に進んで合う
    expect(runReplay(record, { maxTicks: record.endTick }).ok).toBe(true);
    // プレイヤーにも同じ上限を渡せる（長すぎる記録は立てない等の制御に使う）
    const start = createReplayPlayer(record, { maxTicks: record.endTick - 1 });
    expect(start.ok).toBe(false);
    if (!start.ok) expect(start.reason).toBe('tooLong');
    // 上限を渡さなければ、同じ記録は普通に立つ
    expect(createReplayPlayer(record).ok).toBe(true);
  });

  it('上限を越えても rulesVersion の判定は先に効く（版が違う記録は rulesMismatch のまま）', () => {
    const record = quietRecord(60);
    const huge: ReplayRecord = { ...record, endTick: MAX_REPLAY_TICKS + 1, rulesVersion: 'r0.00000000' };
    const run = runReplay(huge);
    expect(run.ok).toBe(false);
    // 版の判定が一番先。長さと版が両方おかしい記録は rulesMismatch が返る
    if (!run.ok) expect(run.reason).toBe('rulesMismatch');
  });
});
