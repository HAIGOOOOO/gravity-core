// 「Tier ごとの初到達」の計測のテスト。
// 3 層で確かめる:
//   - createPaceTracker / summarizePace: 偽のイベント・記録で計算だけ（速い）
//   - measurePace: 実シミュレーションで端から端まで

import { describe, expect, it } from 'vitest';
import type { GameEvent, GameEventKind } from '../contracts/game';
import { at, dropAt, onCore } from '../fixtures/index';
import { START_BODY, TICK_HZ, TIER_COUNT } from '../game/constants';
import { measureAccuracy } from './accuracy';
import { mergeBot, randomBot, type Bot } from './bots';
import { createPaceTracker, measurePace, measurePaceBatch, setupTiers, summarizePace, tierPace } from './pace';

function ev(kind: GameEventKind, over: Partial<GameEvent> = {}): GameEvent {
  return { sequence: 0, tick: 0, kind, ...over };
}

describe('createPaceTracker', () => {
  it('launch の sourceTier と merge の resultTier を、それぞれの tick で記録する', () => {
    const tr = createPaceTracker();
    tr.handleEvent(ev('launch', { tick: 10, sourceTier: 2 }));
    tr.handleEvent(ev('merge', { tick: 30, resultTier: 3 }));
    const reach = tr.finish();
    expect(reach).toHaveLength(TIER_COUNT);
    expect(reach[2]).toBe(10);
    expect(reach[3]).toBe(30);
    expect(reach[0]).toBeNull();
  });

  it('最初に届いた tick だけを残す（あとの到達では上書きしない）', () => {
    const tr = createPaceTracker();
    tr.handleEvent(ev('merge', { tick: 30, resultTier: 3 }));
    tr.handleEvent(ev('merge', { tick: 80, resultTier: 3 }));
    tr.handleEvent(ev('launch', { tick: 90, sourceTier: 3 }));
    expect(tr.finish()[3]).toBe(30);
  });

  it('開始時の天体は 0 で到達扱い。他のイベントや tier の無いイベントは無視する', () => {
    const tr = createPaceTracker([0, 4]);
    tr.handleEvent(ev('supernova', { tick: 50, sourceTier: 8 })); // 新しい天体を生まない
    tr.handleEvent(ev('land', { tick: 60, bodyIds: [1], sourceTier: 5 })); // launch 時に記録済み
    tr.handleEvent(ev('merge', { tick: 70 })); // resultTier なし（防御）
    tr.handleEvent(ev('launch', { tick: 80 })); // sourceTier なし（防御）
    const reach = tr.finish();
    expect(reach[0]).toBe(0);
    expect(reach[4]).toBe(0);
    expect(reach[5]).toBeNull();
    expect(reach[8]).toBeNull();
  });
});

describe('setupTiers', () => {
  it('setup.bodies があればその Tier たち、無ければ START_BODY、空なら空', () => {
    expect(setupTiers({ bodies: [at(5, 250, 0), at(7, 150, 1)] })).toEqual([5, 7]);
    expect(setupTiers(undefined)).toEqual([START_BODY.tier]);
    expect(setupTiers({})).toEqual([START_BODY.tier]);
    // bodies が空配列ならシミュレーションも START_BODY を置かないので、空が正しい
    expect(setupTiers({ bodies: [] })).toEqual([]);
  });
});

describe('tierPace / summarizePace', () => {
  it('tick を秒に換算する（null はそのまま）', () => {
    const p = tierPace(9, [0, 120, null]);
    expect(p.seed).toBe(9);
    expect(p.reachSeconds).toEqual([0, 1, null]);
  });

  it('Tier ごとに「届いた率」と秒の分布を出す。届かない Tier も行を作る', () => {
    const paces = [tierPace(1, [0, 100, 200, null]), tierPace(2, [0, 300, null, null])];
    const s = summarizePace(paces);
    expect(s).toHaveLength(TIER_COUNT);
    // Tier 0: 2/2 到達・秒は全部 0
    expect(s[0]!.reachRate).toBe(1);
    expect(s[0]!.seconds.median).toBe(0);
    // Tier 1: 2/2 到達・分布は届いた 2 件だけから出す
    expect(s[1]!.reachRate).toBe(1);
    expect(s[1]!.seconds.n).toBe(2);
    expect(s[1]!.seconds.median).toBeCloseTo((100 + 300) / 2 / TICK_HZ, 9);
    // Tier 2: 1/2
    expect(s[2]!.reachRate).toBe(0.5);
    expect(s[2]!.seconds.n).toBe(1);
    // Tier 3 以降: 0%。行はあるが値は NaN
    expect(s[3]!.reachRate).toBe(0);
    expect(s[3]!.seconds.n).toBe(0);
    expect(s[3]!.seconds.median).toBeNaN();
  });

  it('空なら率は NaN', () => {
    const s = summarizePace([]);
    expect(s).toHaveLength(TIER_COUNT);
    expect(s[0]!.reachRate).toBeNaN();
    expect(s[0]!.seconds.n).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 実シミュレーションで端から端まで

describe('実シミュレーションでの計測', () => {
  it('狙った場所に撃つボット: 合体で Tier が育ち、その tick が記録される', () => {
    const angle = 0.9;
    const sniper: Bot = { name: 'sniper', decide: () => dropAt(angle) };
    const { result, pace } = measurePace(sniper, {
      seed: 1,
      maxTicks: 2 * TICK_HZ,
      setup: { bodies: [onCore(0, angle)], queue: [0, 0, 0] },
    });
    expect(result.merges).toBeGreaterThanOrEqual(1);
    // setup の Tier 0 は 0 秒で到達扱い
    expect(pace.reachTicks[0]).toBe(0);
    // Tier 1 は合体が起きた tick（撃つより後）で到達
    expect(pace.reachTicks[1]).not.toBeNull();
    expect(pace.reachTicks[1]!).toBeGreaterThan(0);
    expect(pace.reachSeconds[1]).toBeCloseTo(pace.reachTicks[1]! / TICK_HZ, 9);
    // 届いた Tier は「ひとつ下も届いていて、それ以降」: 上だけ先に届く事は無い
    for (let k = 1; k < TIER_COUNT; k++) {
      const cur = pace.reachTicks[k];
      if (cur === null || cur === undefined) continue;
      const prev = pace.reachTicks[k - 1];
      expect(prev).not.toBeNull();
      expect(cur).toBeGreaterThanOrEqual(prev!);
    }
  });

  it('setup 無しの普通のプレイでは、bestTierThisRun は必ず届いていて、上振れはキューの +1 まで', () => {
    const { result, pace } = measurePace(mergeBot(7), { seed: 7, maxTicks: 15 * TICK_HZ });
    // 開始の START_BODY（Tier 0）は 0 で到達
    expect(pace.reachTicks[0]).toBe(0);
    // 合体で作った Tier は必ず merge イベントに載るので、bestTier は必ず届いている
    expect(pace.reachTicks[result.bestTier]).not.toBeNull();
    let top = -1;
    for (let k = 0; k < TIER_COUNT; k++) {
      if (pace.reachTicks[k] !== null && pace.reachTicks[k] !== undefined) top = k;
    }
    expect(top).toBeGreaterThanOrEqual(result.bestTier);
    // キューの抽選は bestTier 以下までしか出さない。例外は bestTier=0 の時だけ
    // Tier 1 が出る（QUEUE_TABLE の先頭行）ので、上振れは最高でも 1 段
    expect(top).toBeLessThanOrEqual(Math.max(1, result.bestTier));
  });

  it('setup の天体は Tier に関係なく 0 で到達扱い（bestTier とは無関係）', () => {
    const { pace } = measurePace(randomBot(1), {
      seed: 1,
      maxTicks: TICK_HZ,
      setup: { bodies: [at(5, 250, 0), at(7, 150, 1)], queue: [0, 0, 0] },
    });
    expect(pace.reachTicks[5]).toBe(0);
    expect(pace.reachTicks[7]).toBe(0);
    expect(pace.reachSeconds[7]).toBe(0);
  });

  it('撃てないボットなら開始時の天体だけが届く', () => {
    const stubborn: Bot = { name: 'stubborn', decide: () => ({ originAngleRadians: 0, vx: 0, vy: 0 }) };
    const { result, pace } = measurePace(stubborn, {
      seed: 1,
      maxTicks: 10 * TICK_HZ,
      setup: { bodies: [at(6, 250, 0)], queue: [0, 0, 0] },
    });
    expect(result.launches).toBe(0);
    expect(pace.reachTicks[6]).toBe(0);
    for (let k = 0; k < TIER_COUNT; k++) {
      if (k !== 6) expect(pace.reachTicks[k]).toBeNull();
    }
  });

  it('決定的: 同じシードで 2 度測ると記録は全く同じ', () => {
    const a = measurePace(mergeBot(11), { seed: 11, maxTicks: 10 * TICK_HZ });
    const b = measurePace(mergeBot(11), { seed: 11, maxTicks: 10 * TICK_HZ });
    expect(a.pace).toEqual(b.pace);
  });

  it('利用側の hooks も最後に呼ぶ（onLaunch・onEvents とも）', () => {
    let launches = 0;
    let eventTicks = 0;
    const { result } = measurePace(randomBot(2), {
      seed: 2,
      maxTicks: 5 * TICK_HZ,
      hooks: {
        onLaunch: () => launches++,
        onEvents: () => eventTicks++,
      },
    });
    expect(launches).toBe(result.launches);
    expect(launches).toBeGreaterThan(0);
    // stepFixed 1 回ごとに呼ばれるので、進んだ tick 数と一致する
    expect(eventTicks).toBe(result.ticks);
  });

  it('measureAccuracy の観察口に混ぜられる（1 まわしで 2 種類の記録を取る形）', () => {
    const tracker = createPaceTracker(setupTiers(undefined));
    const { shots } = measureAccuracy(mergeBot(5), {
      seed: 5,
      maxTicks: 10 * TICK_HZ,
      hooks: {
        onEvents: (events) => {
          for (const e of events) tracker.handleEvent(e);
        },
      },
    });
    const reach = tracker.finish();
    expect(shots.length).toBeGreaterThan(0);
    // START_BODY は 0 で到達、的中率の記録と同じまわしで育ち方も取れている
    expect(reach[0]).toBe(0);
  });
});

describe('measurePaceBatch', () => {
  it('回ごとの結果と pace を返し、シードで区別できる', () => {
    const m = measurePaceBatch(randomBot, { runs: 2, seedStart: 10, maxTicks: 10 * TICK_HZ });
    expect(m.runs).toHaveLength(2);
    expect(m.paces).toHaveLength(2);
    expect(m.paces.map((p) => p.seed)).toEqual([10, 11]);
    // 同じ条件でまわし直しても同じ
    const again = measurePaceBatch(randomBot, { runs: 2, seedStart: 10, maxTicks: 10 * TICK_HZ });
    expect(again.paces).toEqual(m.paces);
  });

  it('0 回なら空を返す', () => {
    const m = measurePaceBatch(randomBot, { runs: 0 });
    expect(m.runs).toEqual([]);
    expect(m.paces).toEqual([]);
  });
});
