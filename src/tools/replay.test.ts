import { describe, expect, it } from 'vitest';
import { at, dropAt } from '../fixtures/index';
import { TICK_HZ } from '../game/constants';
import type { SimulationSetup } from '../game/simulation';
import { playOnce } from './batch';
import { mergeBot, randomBot, safeMergeBot, type Bot } from './bots';
import { replayLaunches } from './replay';

const SHORT = 20 * TICK_HZ;

/** 積もるとリングをはみ出す 3 体の山（batch.test.ts と同じ、熱量が 100 まで上がる事が確かめ済みの形） */
const PILE: SimulationSetup = {
  bodies: [at(7, 130, 0), at(6, 280, 0), at(5, 400, 0)],
  heat: 95,
  bestTier: 8,
};

describe('replayLaunches', () => {
  it('入力ログから同じプレイを完全に再現できる（スナップショット全項目一致）', () => {
    const seed = 42;
    const { sim, result } = playOnce(safeMergeBot(seed), { seed, maxTicks: SHORT });
    const log = sim.getInputLog();
    expect(log.length).toBe(result.launches);
    expect(log.length).toBeGreaterThan(0);

    const replay = replayLaunches(seed, log, { stopTick: result.ticks });
    // 元のプレイで受理された射出は全部、再現でも受理される
    expect(replay.submitted).toBe(log.length);
    // 盤面・得点・熱量・キュー・待ち時間まで同じ = 途中の物理も全て同じ
    expect(replay.sim.getSnapshot()).toEqual(sim.getSnapshot());
  });

  it('setup ありのプレイも、同じ setup を渡せば再現できる（result.setup に残る）', () => {
    const setup: SimulationSetup = { bodies: [at(2, 150, 1), at(4, 260, -2), at(0, 300, 3)], heat: 10 };
    const { sim, result } = playOnce(randomBot(3), { seed: 3, maxTicks: 10 * TICK_HZ, setup });
    expect(result.setup).toEqual(setup);

    const replay = replayLaunches(result.seed, sim.getInputLog(), { stopTick: result.ticks, setup: result.setup });
    expect(replay.sim.getSnapshot()).toEqual(sim.getSnapshot());
  });

  it('再現も決定的: 同じログを 2 度まわすと同じ盤面になる', () => {
    const { sim } = playOnce(mergeBot(9), { seed: 9, maxTicks: 15 * TICK_HZ });
    const a = replayLaunches(9, sim.getInputLog(), { stopTick: 15 * TICK_HZ });
    const b = replayLaunches(9, sim.getInputLog(), { stopTick: 15 * TICK_HZ });
    expect(a.sim.getSnapshot()).toEqual(b.sim.getSnapshot());
    expect(a.submitted).toBe(b.submitted);
  });

  it('空のログ = 射出なしで stopTick まで進む（全部弾かれたプレイも再現できる）', () => {
    const stubborn: Bot = { name: 'stubborn', decide: () => ({ originAngleRadians: 0, vx: 0, vy: 0 }) };
    const { sim, result } = playOnce(stubborn, { seed: 1, maxTicks: 10 * TICK_HZ });
    expect(result.launches).toBe(0);
    expect(sim.getInputLog()).toHaveLength(0);

    const replay = replayLaunches(1, sim.getInputLog(), { stopTick: result.ticks });
    expect(replay.submitted).toBe(0);
    expect(replay.sim.getSnapshot()).toEqual(sim.getSnapshot());
  });

  it('記録の時点より早く終わる盤面では、残りの入力は弾かれて終了のまま止まる', () => {
    // 熱量 95 開始の山は 2 秒ほどで終わる。5 秒先・9 秒先の入力は全部届かない
    const log = [
      { tick: 5 * TICK_HZ, ...dropAt(0) },
      { tick: 9 * TICK_HZ, ...dropAt(1) },
    ];
    const replay = replayLaunches(1, log, { setup: PILE, stopTick: 60 * TICK_HZ });
    expect(replay.submitted).toBe(0);
    const s = replay.sim.getSnapshot();
    expect(s.phase).toBe('over');
    expect(s.tick).toBeLessThan(5 * TICK_HZ);
  });

  it('記録された tick を過ぎた入力は、いまの tick で撃つ（手で並べ替えたログ向け）', () => {
    // 先に tick 200 の無効な射出（受理されない）、あとから tick 50 の有効な射出。
    // 50 はもう過ぎているので、現在の 200 で撃つ → 新しいログには tick 200 で残る
    const log = [
      { tick: 200, originAngleRadians: 0, vx: 0, vy: 0 },
      { tick: 50, ...dropAt(1) },
    ];
    const replay = replayLaunches(1, log, { stopTick: 400 });
    expect(replay.submitted).toBe(1);
    const recorded = replay.sim.getInputLog();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.tick).toBe(200);
  });

  it('stopTick が最後の入力より前でも、入力は全部撃ってから止まる', () => {
    const log = [{ tick: 5 * TICK_HZ, ...dropAt(0) }];
    const replay = replayLaunches(1, log, { stopTick: TICK_HZ });
    expect(replay.submitted).toBe(1);
    // 入力の時点までは必ず進むので、終点は stopTick を越えた 5 秒
    expect(replay.sim.getSnapshot().tick).toBe(5 * TICK_HZ);
  });

  it('stopTick を省略すると、終了まで進んで止まる（既定の上限に届かない）', () => {
    const replay = replayLaunches(1, [], { setup: PILE });
    const s = replay.sim.getSnapshot();
    expect(s.phase).toBe('over');
    // 2 秒ちょっとで終わるので、10 分の上限には遠く及ばない
    expect(s.tick).toBeLessThan(60 * TICK_HZ);
  });
});
