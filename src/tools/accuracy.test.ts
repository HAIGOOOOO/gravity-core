// 「予測どおりにいったか」の計測のテスト。
// 3 層で確かめる:
//   - summarizeAccuracy: 偽の記録で集計だけ（速い）
//   - createAccuracyTracker: 偽のイベントで追跡のロジックだけ
//   - measureAccuracy: 実シミュレーションで端から端まで

import { describe, expect, it } from 'vitest';
import type { GameEvent, GameEventKind, Prediction } from '../contracts/game';
import { dropAt, onCore } from '../fixtures/index';
import { TICK_HZ } from '../game/constants';
import { playOnce } from './batch';
import { mergeBot, randomBot, type Bot } from './bots';
import {
  countOutcomes,
  createAccuracyTracker,
  measureAccuracy,
  measureAccuracyBatch,
  mergeMisses,
  summarizeAccuracy,
  type ShotRecord,
} from './accuracy';

// ---------------------------------------------------------------------------
// 偽の記録・イベントを作る部品

function shot(over: Partial<ShotRecord> = {}): ShotRecord {
  return {
    seed: 1,
    tick: 0,
    bodyId: 1,
    tier: 0,
    command: dropAt(0),
    predictedEnd: 'body',
    predictedMerge: false,
    predictedHitBodyId: null,
    predictedPoint: null,
    outcome: 'noContact',
    landTick: null,
    landPoint: null,
    mergePartners: [],
    mergeTick: null,
    ...over,
  };
}

function ev(kind: GameEventKind, over: Partial<GameEvent> = {}): GameEvent {
  return { sequence: 0, tick: 0, kind, ...over };
}

function pred(over: Partial<Prediction> = {}): Prediction {
  return { valid: true, points: [], end: 'timeLimit', hitBodyId: null, willMerge: false, ...over };
}

// ---------------------------------------------------------------------------

describe('summarizeAccuracy', () => {
  it('空なら全部 0 で率は NaN', () => {
    const s = summarizeAccuracy([]);
    expect(s.shots).toBe(0);
    expect(s.mergeHitRate).toBeNaN();
    expect(s.partnerMatchRate).toBeNaN();
    expect(s.landError.median).toBeNaN();
  });

  it('的中・外れ・予測外・着地後合体・未接触を数え分ける', () => {
    const s = summarizeAccuracy([
      // 予測どおり最初の接触が合体。相手も合っている
      shot({ bodyId: 1, predictedMerge: true, predictedHitBodyId: 5, outcome: 'merged', mergePartners: [5], mergeTick: 10 }),
      // 予測は合体だったが着地した（外れ）
      shot({ bodyId: 2, predictedMerge: true, predictedHitBodyId: 5, outcome: 'landed', predictedPoint: { x: 0, y: 0 }, landPoint: { x: 1, y: 0 } }),
      // 予測していないのに最初の接触が合体（盤面が動いて偶然）
      shot({ bodyId: 3, predictedMerge: false, outcome: 'merged', mergePartners: [9], mergeTick: 20 }),
      // 着地してから押し出されて合体
      shot({ bodyId: 4, outcome: 'landedThenMerged', predictedPoint: { x: 0, y: 0 }, landPoint: { x: 3, y: 4 }, mergePartners: [7], mergeTick: 30 }),
      // 終了まで何も触れなかった
      shot({ bodyId: 5, outcome: 'noContact' }),
    ]);
    expect(s.shots).toBe(5);
    expect(s.predictedMerges).toBe(2);
    expect(s.mergeHits).toBe(1);
    expect(s.mergeHitRate).toBe(0.5);
    expect(s.mergeMisses).toBe(1);
    expect(s.actualMerges).toBe(2);
    expect(s.surpriseMerges).toBe(1);
    expect(s.landedThenMerged).toBe(1);
    expect(s.noContact).toBe(1);
    // 相手が分かる 'merged' は bodyId 1 だけ → 予測の 5 と実際の 5 が一致
    expect(s.partnerMatchRate).toBe(1);
    // 着地誤差: bodyId 2 は 1、bodyId 4 は 5 → 中央値 3
    expect(s.landError.median).toBe(3);
    expect(s.landError.min).toBe(1);
    expect(s.landError.max).toBe(5);
  });

  it('合体の相手が予測と違えば相手一致率が下がる', () => {
    const s = summarizeAccuracy([
      shot({ bodyId: 1, predictedMerge: true, predictedHitBodyId: 5, outcome: 'merged', mergePartners: [5], mergeTick: 1 }),
      shot({ bodyId: 2, predictedMerge: true, predictedHitBodyId: 5, outcome: 'merged', mergePartners: [9], mergeTick: 2 }),
    ]);
    expect(s.partnerMatchRate).toBe(0.5);
  });

  it('予測合体なのに未接触でも「外れ」に数える', () => {
    const s = summarizeAccuracy([
      shot({ predictedMerge: true, predictedHitBodyId: 3, outcome: 'noContact' }),
    ]);
    expect(s.mergeHits).toBe(0);
    expect(s.mergeMisses).toBe(1);
    expect(s.mergeHitRate).toBe(0);
  });

  it('着地したが予測点が無い射出は着地誤差に入れない', () => {
    const s = summarizeAccuracy([
      shot({ outcome: 'landed', landPoint: { x: 10, y: 0 }, predictedPoint: null }),
      shot({ outcome: 'landed', landPoint: { x: 4, y: 0 }, predictedPoint: { x: 0, y: 0 } }),
    ]);
    expect(s.landError.n).toBe(1);
    expect(s.landError.median).toBe(4);
  });

  it('合体を予測して着地→合体した射出も「外れ」に数える（最初の接触が合体ではない）', () => {
    const s = summarizeAccuracy([
      shot({ predictedMerge: true, predictedHitBodyId: 3, outcome: 'landedThenMerged', mergePartners: [3], mergeTick: 9 }),
    ]);
    expect(s.mergeHits).toBe(0);
    expect(s.mergeMisses).toBe(1);
    // landedThenMerged は「最初の接触が合体」の母数に入らないので、相手一致の母数にも入らない
    expect(s.actualMerges).toBe(0);
    expect(s.partnerMatchRate).toBeNaN();
  });
});

describe('外れを拾う・内訳を数える', () => {
  it('mergeMisses: 「合体を予測したのに合体しなかった」射出だけを返す', () => {
    const shots = [
      shot({ bodyId: 1, predictedMerge: true, outcome: 'merged' }),
      shot({ bodyId: 2, predictedMerge: true, outcome: 'landed', landTick: 9 }),
      shot({ bodyId: 3, predictedMerge: true, outcome: 'landedThenMerged', landTick: 8, mergeTick: 40 }),
      shot({ bodyId: 4, predictedMerge: true, outcome: 'noContact' }),
      shot({ bodyId: 5, predictedMerge: false, outcome: 'landed' }),
      shot({ bodyId: 6, predictedMerge: false, outcome: 'merged' }), // 予測外の合体は外れではない
    ];
    const misses = mergeMisses(shots);
    expect(misses.map((s) => s.bodyId)).toEqual([2, 3, 4]);
    expect(mergeMisses([])).toEqual([]);
  });

  it('countOutcomes: 結末ごとの件数を予測の有無で分ける', () => {
    const c = countOutcomes([
      shot({ predictedMerge: true, outcome: 'merged' }),
      shot({ predictedMerge: true, outcome: 'landed' }),
      shot({ predictedMerge: true, outcome: 'landed' }),
      shot({ predictedMerge: false, outcome: 'landed' }),
      shot({ predictedMerge: false, outcome: 'noContact' }),
      shot({ predictedMerge: false, outcome: 'merged' }),
    ]);
    expect(c.merged).toEqual({ predicted: 1, other: 1 });
    expect(c.landed).toEqual({ predicted: 2, other: 1 });
    expect(c.landedThenMerged).toEqual({ predicted: 0, other: 0 });
    expect(c.noContact).toEqual({ predicted: 0, other: 1 });
  });
});

// ---------------------------------------------------------------------------

describe('createAccuracyTracker', () => {
  it('land イベントで着地の時刻と位置を記録する', () => {
    const tr = createAccuracyTracker(7);
    tr.beginShot(10, dropAt(0), pred({ end: 'body', hitBodyId: 3, points: [{ x: 10, y: 5, t: 0.5 }] }), 42, 3);
    tr.handleEvent(ev('land', { tick: 12, bodyIds: [42], x: 30, y: 40 }));
    const rec = tr.finish()[0]!;
    expect(rec.outcome).toBe('landed');
    expect(rec.landTick).toBe(12);
    expect(rec.landPoint).toEqual({ x: 30, y: 40 });
    expect(rec.predictedPoint).toEqual({ x: 10, y: 5 });
    expect(rec.tick).toBe(10);
    expect(rec.seed).toBe(7);
    // beginShot に渡した Tier が記録に残る（どの Tier の射出が外れたかを見るため）
    expect(rec.tier).toBe(3);
  });

  it('land 前に merge で消費されたら merged。相手は末尾の子を除いた残り', () => {
    const tr = createAccuracyTracker(1);
    tr.beginShot(0, dropAt(0), pred({ willMerge: true, hitBodyId: 20 }), 10, 0);
    tr.handleEvent(ev('merge', { tick: 5, bodyIds: [10, 20, 99] }));
    const rec = tr.finish()[0]!;
    expect(rec.outcome).toBe('merged');
    expect(rec.mergeTick).toBe(5);
    expect(rec.mergePartners).toEqual([20]);
  });

  it('追跡中の 2 体どうしが合体したら、お互いが相手になる', () => {
    const tr = createAccuracyTracker(1);
    tr.beginShot(0, dropAt(0), pred(), 10, 0);
    tr.beginShot(5, dropAt(1), pred(), 20, 0);
    tr.handleEvent(ev('merge', { tick: 30, bodyIds: [10, 20, 99] }));
    const [a, b] = tr.finish();
    expect(a!.mergePartners).toEqual([20]);
    expect(b!.mergePartners).toEqual([10]);
  });

  it('merge イベントの末尾（生まれた子）は消費として数えない', () => {
    const tr = createAccuracyTracker(1);
    tr.beginShot(0, dropAt(0), pred(), 99, 0);
    tr.handleEvent(ev('merge', { tick: 5, bodyIds: [10, 20, 99] }));
    const rec = tr.finish()[0]!;
    expect(rec.outcome).toBe('noContact');
  });

  it('supernova は末尾の子がいないので 2 体とも消費', () => {
    const tr = createAccuracyTracker(1);
    tr.beginShot(0, dropAt(0), pred(), 10, 0);
    tr.beginShot(0, dropAt(1), pred(), 20, 0);
    tr.handleEvent(ev('supernova', { tick: 8, bodyIds: [10, 20] }));
    const [a, b] = tr.finish();
    expect(a!.outcome).toBe('merged');
    expect(b!.outcome).toBe('merged');
  });

  it('land のあと merge で消費されたら landedThenMerged', () => {
    const tr = createAccuracyTracker(1);
    tr.beginShot(0, dropAt(0), pred(), 10, 0);
    tr.handleEvent(ev('land', { tick: 5, bodyIds: [10], x: 1, y: 2 }));
    tr.handleEvent(ev('merge', { tick: 50, bodyIds: [10, 30, 40] }));
    const rec = tr.finish()[0]!;
    expect(rec.outcome).toBe('landedThenMerged');
    expect(rec.landTick).toBe(5);
    expect(rec.landPoint).toEqual({ x: 1, y: 2 });
    expect(rec.mergePartners).toEqual([30]);
  });

  it('何も起きなければ noContact。予測の points が空なら predictedPoint は null', () => {
    const tr = createAccuracyTracker(1);
    tr.beginShot(0, dropAt(0), pred({ points: [] }), 10, 0);
    const rec = tr.finish()[0]!;
    expect(rec.outcome).toBe('noContact');
    expect(rec.predictedPoint).toBeNull();
    expect(rec.landTick).toBeNull();
    expect(rec.landPoint).toBeNull();
  });

  it('知らない天体・bodyIds の無いイベントは無視する', () => {
    const tr = createAccuracyTracker(1);
    tr.beginShot(0, dropAt(0), pred(), 10, 0);
    tr.handleEvent(ev('land', { tick: 1, bodyIds: [777], x: 0, y: 0 }));
    tr.handleEvent(ev('launch', { tick: 1 }));
    tr.handleEvent(ev('overLimitStart', { tick: 2 }));
    tr.handleEvent(ev('merge', { tick: 3 }));
    expect(tr.finish()[0]!.outcome).toBe('noContact');
  });

  it('merge の bodyIds が 2 件しか無ければ全部消費として扱う（防御）', () => {
    const tr = createAccuracyTracker(1);
    tr.beginShot(0, dropAt(0), pred(), 10, 0);
    tr.handleEvent(ev('merge', { tick: 5, bodyIds: [10, 20] }));
    expect(tr.finish()[0]!.outcome).toBe('merged');
    expect(tr.finish()[0]!.mergePartners).toEqual([20]);
  });
});

// ---------------------------------------------------------------------------
// 実シミュレーションで端から端まで

describe('実シミュレーションでの計測', () => {
  it('狙った場所に撃つボット: 予測どおり合体し、相手も合っている', () => {
    // 核の表面・角度 0.9 に Tier 0 を 1 体。そこへ真っすぐ撃ち続ける
    const angle = 0.9;
    const sniper: Bot = { name: 'sniper', decide: () => dropAt(angle) };
    const { result, shots, summary } = measureAccuracy(sniper, {
      seed: 1,
      maxTicks: 2 * TICK_HZ,
      setup: { bodies: [onCore(0, angle)], queue: [0, 0, 0] },
    });
    expect(shots).toHaveLength(result.launches);
    expect(shots.length).toBeGreaterThan(0);
    // 最初の 1 射は必ず「合体する」と予測され、実際に合体する（盤面はまだ動かない）
    const first = shots[0]!;
    expect(first.predictedMerge).toBe(true);
    expect(first.predictedHitBodyId).toBe(1); // setup の天体は id 1
    expect(first.outcome).toBe('merged');
    expect(first.mergePartners).toEqual([1]);
    // 撃った天体の Tier はキューの先頭（[0,0,0] なので 0）、着地していないので landTick は null
    expect(first.tier).toBe(0);
    expect(first.landTick).toBeNull();
    expect(summary.predictedMerges).toBeGreaterThanOrEqual(1);
    expect(summary.mergeHits).toBeGreaterThanOrEqual(1);
    expect(summary.mergeHitRate).toBeGreaterThan(0);
    expect(summary.shots).toBe(result.launches);
  });

  it('決定的: 同じシードで 2 度測ると記録も集計も全く同じ', () => {
    const a = measureAccuracy(mergeBot(7), { seed: 7, maxTicks: 10 * TICK_HZ });
    const b = measureAccuracy(mergeBot(7), { seed: 7, maxTicks: 10 * TICK_HZ });
    expect(a.shots).toEqual(b.shots);
    expect(a.summary).toEqual(b.summary);
  });

  it('いつも断られるボットは 0 射出・0 記録', () => {
    const stubborn: Bot = { name: 'stubborn', decide: () => ({ originAngleRadians: 0, vx: 0, vy: 0 }) };
    const { shots, summary } = measureAccuracy(stubborn, { seed: 1, maxTicks: 5 * TICK_HZ });
    expect(shots).toEqual([]);
    expect(summary.shots).toBe(0);
    expect(summary.mergeHitRate).toBeNaN();
  });

  it('キューの Tier が記録に残る（撃った天体が何だったか分かる）', () => {
    // 撃つ直前に見えたキューを全部残し、記録の Tier と照合する
    const queues: number[][] = [];
    const { shots } = measureAccuracy(randomBot(1), {
      seed: 1,
      maxTicks: 5 * TICK_HZ,
      setup: { queue: [4, 4, 4] },
      hooks: {
        onLaunch: (_c, _p, _id, _t, snap) => {
          queues.push([...snap.nextQueue]);
        },
      },
    });
    expect(shots.length).toBeGreaterThanOrEqual(3);
    expect(queues).toHaveLength(shots.length);
    // キュー [4,4,4] を先から消費するので、最初の 3 射は Tier 4
    for (const s of shots.slice(0, 3)) expect(s.tier).toBe(4);
    // 4 射目以降の値は抽選次第（Tier 4 どうしの合体で bestTier が上がると Tier 4 も出る）。
    // 決められるのは「記録の Tier = 撃つ直前のキューの先頭」と「キューは順に消費される」だけ
    for (let i = 0; i < shots.length; i++) expect(shots[i]!.tier).toBe(queues[i]![0]);
    for (let i = 1; i < shots.length; i++) {
      expect(queues[i]![0]).toBe(queues[i - 1]![1]);
      expect(queues[i]![1]).toBe(queues[i - 1]![2]);
    }
  });

  it('着地した射出には landTick が付き、撃った tick 以降になる', () => {
    const { shots } = measureAccuracy(randomBot(3), { seed: 3, maxTicks: 10 * TICK_HZ });
    const landed = shots.filter((s) => s.outcome === 'landed' || s.outcome === 'landedThenMerged');
    expect(landed.length).toBeGreaterThan(0);
    for (const s of landed) {
      expect(s.landTick).not.toBeNull();
      expect(s.landTick!).toBeGreaterThanOrEqual(s.tick);
    }
    // 着地も合体もしなかった射出には landTick が付かない
    for (const s of shots.filter((x) => x.outcome === 'noContact')) expect(s.landTick).toBeNull();
  });

  it('measureAccuracyBatch: 回ごとの結果と、まとめた記録・集計を返す', () => {
    const m = measureAccuracyBatch(randomBot, { runs: 2, seedStart: 10, maxTicks: 10 * TICK_HZ });
    expect(m.runs).toHaveLength(2);
    expect(m.shots).toHaveLength(m.runs[0]!.launches + m.runs[1]!.launches);
    // 記録は回ごとのシードで区別できる
    const seeds = new Set(m.shots.map((s) => s.seed));
    expect(seeds).toEqual(new Set([10, 11]));
    expect(m.summary.shots).toBe(m.shots.length);
    // 同じ条件でまわし直しても同じ集計になる
    const again = measureAccuracyBatch(randomBot, { runs: 2, seedStart: 10, maxTicks: 10 * TICK_HZ });
    expect(again.summary).toEqual(m.summary);
  });
});

describe('playOnce の観察用フック', () => {
  it('onLaunch は受理分だけ呼ばれ、onEvents は 1 tick に 1 回呼ばれる', () => {
    let launches = 0;
    let eventTicks = 0;
    let events = 0;
    const { result } = playOnce(randomBot(3), {
      seed: 3,
      maxTicks: 5 * TICK_HZ,
      hooks: {
        onLaunch: (_command, prediction, bodyId, tick, snapshot) => {
          launches++;
          // 撃つ直前に取った予測なので、有効な予測が来ている
          expect(prediction.valid).toBe(true);
          expect(bodyId).toBeGreaterThan(0);
          expect(tick).toBeLessThanOrEqual(5 * TICK_HZ);
          // 撃つ直前の盤面も渡る（nextQueue[0] が撃った天体の Tier）
          expect(snapshot.bodies.length).toBeGreaterThan(0);
          expect(snapshot.tick).toBe(tick);
        },
        onEvents: (list) => {
          eventTicks++;
          events += list.length;
        },
      },
    });
    expect(launches).toBe(result.launches);
    expect(launches).toBeGreaterThan(0);
    // stepFixed 1 回ごとに呼ばれるので、進んだ tick 数と一致する
    expect(eventTicks).toBe(result.ticks);
    expect(events).toBeGreaterThan(0);
  });
});
