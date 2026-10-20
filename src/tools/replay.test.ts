import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../contracts/game';
import { at, dropAt, onCore } from '../fixtures/index';
import { TICK_HZ } from '../game/constants';
import type { SimulationSetup } from '../game/simulation';
import { measureAccuracy } from './accuracy';
import { playOnce } from './batch';
import { mergeBot, randomBot, safeMergeBot, type Bot } from './bots';
import { boardBeforeShot, continueReplay, replayLaunches } from './replay';

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

  it('stopTick を省略して maxTicks だけ渡すと、そこまで進んで止まる', () => {
    const replay = replayLaunches(1, [], { maxTicks: 2 * TICK_HZ });
    expect(replay.submitted).toBe(0);
    const s = replay.sim.getSnapshot();
    expect(s.phase).toBe('active');
    expect(s.tick).toBe(2 * TICK_HZ);
  });
});

describe('boardBeforeShot（射出の直前の盤面を再現）', () => {
  it('戻った盤面で predict すると、記録と同じ予測が返る（全射出で確かめる）', () => {
    const seed = 7;
    const { shots, sim } = measureAccuracy(mergeBot(seed), { seed, maxTicks: 15 * TICK_HZ });
    expect(shots.length).toBeGreaterThan(0);
    const log = sim.getInputLog();
    for (const shot of shots) {
      const before = boardBeforeShot(seed, log, shot.tick);
      // ボットが decide した時の盤面に戻っている
      const s = before.getSnapshot();
      expect(s.tick).toBe(shot.tick);
      expect(s.phase).toBe('active');
      // 予測は盤面だけで決まるので、記録の予測と一致する
      const p = before.predict(shot.command);
      // 受理された射出の予測は必ず valid（invalid なら撃てず記録に残らない）
      expect(p.valid).toBe(true);
      expect(p.willMerge).toBe(shot.predictedMerge);
      expect(p.end).toBe(shot.predictedEnd);
      expect(p.hitBodyId).toBe(shot.predictedHitBodyId);
      const last = p.points[p.points.length - 1]!;
      expect(last.x).toBe(shot.predictedPoint!.x);
      expect(last.y).toBe(shot.predictedPoint!.y);
    }
  });

  it('撃ち直して進めると、記録と同じ結末が同じ tick で起きる', () => {
    const seed = 7;
    const { shots, sim } = measureAccuracy(mergeBot(seed), { seed, maxTicks: 15 * TICK_HZ });
    const log = sim.getInputLog();
    // 着地か合体が起きた射出だけを追い直す（未接触は終点が無いので外す）
    const ended = shots.filter((s) => s.landTick !== null || s.mergeTick !== null);
    expect(ended.length).toBeGreaterThan(0);
    for (const shot of ended) {
      const sim2 = boardBeforeShot(seed, log, shot.tick);
      // 同じ盤面・同じ乱数列なので、受理も天体番号も同じ
      expect(sim2.submitLaunch(shot.command)).toEqual({ accepted: true, bodyId: shot.bodyId });
      const target = Math.max(shot.landTick ?? 0, shot.mergeTick ?? 0);
      const touched: GameEvent[] = [];
      // 記録の結末は「あとの射出も含むプレイ」の結果なので、残りの入力も撃ち直しながら進める
      continueReplay(
        sim2,
        log.filter((i) => i.tick > shot.tick && i.tick <= target),
        target,
        (e) => {
          const ids = e.bodyIds ?? [];
          // merge の末尾は生まれた子。消費される側だけを見る
          const consumed = e.kind === 'merge' ? ids.slice(0, -1) : ids;
          if (
            (e.kind === 'land' || e.kind === 'merge' || e.kind === 'supernova') &&
            consumed.includes(shot.bodyId)
          ) {
            touched.push(e);
          }
        },
      );
      // 最初にこの天体に起きたイベント = 記録の結末
      expect(touched.length).toBeGreaterThan(0);
      const first = touched[0]!;
      if (shot.landTick !== null) {
        expect(first.kind).toBe('land');
        expect(first.tick).toBe(shot.landTick);
      } else {
        expect(first.kind === 'merge' || first.kind === 'supernova').toBe(true);
        expect(first.tick).toBe(shot.mergeTick);
      }
      // 着地→合体の記録は、合体の方も同じ tick に起きる
      if (shot.mergeTick !== null) {
        const last = touched[touched.length - 1]!;
        expect(last.tick).toBe(shot.mergeTick);
        expect(last.kind === 'merge' || last.kind === 'supernova').toBe(true);
      }
    }
  });

  it('setup ありのプレイでも、同じ setup を渡せば同じ予測が返る', () => {
    const setup: SimulationSetup = { bodies: [onCore(0, 0.9)], queue: [0, 0, 0] };
    const { shots, sim } = measureAccuracy(mergeBot(4), { seed: 4, maxTicks: 5 * TICK_HZ, setup });
    expect(shots.length).toBeGreaterThan(0);
    const log = sim.getInputLog();
    for (const shot of shots) {
      const p = boardBeforeShot(4, log, shot.tick, { setup }).predict(shot.command);
      expect(p.willMerge).toBe(shot.predictedMerge);
      expect(p.end).toBe(shot.predictedEnd);
      expect(p.hitBodyId).toBe(shot.predictedHitBodyId);
    }
  });
});
