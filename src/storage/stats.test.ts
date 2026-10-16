import { describe, expect, it } from 'vitest';
import type { GameEvent, GameEventKind, GameSnapshot } from '../contracts/game';
import { TICK_HZ, TIER_COUNT } from '../game/constants';
import { createAutoPlay, onCore } from '../fixtures';
import { buildRunDetail } from './stats';
import { readRunDetail } from './archive';

const META = { id: 'run-1', playedAt: '2026-10-16T00:00:00.000Z', gameVersion: '0.1.0' } as const;

let sequence = 0;
function event(kind: GameEventKind, tick: number, extra: Partial<GameEvent> = {}): GameEvent {
  return { sequence: sequence++, tick, kind, ...extra };
}
function snapshot(partial: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    tick: 0,
    phase: 'active',
    bodies: [],
    heat: 0,
    overLimit: false,
    score: 0,
    bestTierThisRun: 0,
    nextQueue: [0, 0, 0],
    launchCooldownLeftSeconds: 0,
    seed: 1,
    stats: { launches: 0, merges: 0, supernovas: 0, maxChain: 0 },
    ...partial,
  };
}
const asTier = (value: number) => value as unknown as GameSnapshot['bestTierThisRun'];

describe('プレイ統計の作成', () => {
  it('出来事の列から各項目を数え、限界超過は区間の和を取る', () => {
    const events = [
      event('launch', 1),
      event('land', 30, { impactSpeed: 500 }),
      event('launch', 40),
      event('land', 60, { impactSpeed: 700 }),
      event('merge', 61, { sourceTier: 0, resultTier: 1, chain: 1, scoreDelta: 100 }),
      event('merge', 62, { sourceTier: 1, resultTier: 2, chain: 2, scoreDelta: 330 }),
      event('supernova', 70, { sourceTier: 8, chain: 5, scoreDelta: 99999 }),
      event('overLimitStart', 100),
      event('overLimitEnd', 220),
      event('overLimitStart', 300),
      event('gameOver', 400),
    ];
    const snap = snapshot({
      tick: 400, phase: 'over', score: 1234, bestTierThisRun: 5, seed: 42,
      stats: { launches: 2, merges: 2, supernovas: 1, maxChain: 5 },
    });
    const d = buildRunDetail(events, snap, META);
    expect(d.id).toBe('run-1');
    expect(d.seed).toBe(42);
    expect(d.score).toBe(1234);
    expect(d.seconds).toBeCloseTo(400 / TICK_HZ, 10);
    expect(d.launches).toBe(2);
    expect(d.lands).toBe(2);
    expect(d.merges).toBe(2);
    expect(d.supernovas).toBe(1);
    expect(d.maxChain).toBe(5);
    expect(d.bestTier).toBe(5);
    // 越えていたのは tick 100〜220 と 300〜400（終了まで開きっぱなし）
    expect(d.overLimitSeconds).toBeCloseTo(220 / TICK_HZ, 10);
    expect(d.overLimitEntries).toBe(2);
    expect(d.scorePerLaunch).toBeCloseTo(617, 10);
    expect(d.maxSingleScore).toBe(99999);
    expect(d.maxImpactSpeed).toBe(700);
    expect(d.mergesByTier).toHaveLength(TIER_COUNT);
    expect(d.mergesByTier[0]).toBe(1);
    expect(d.mergesByTier[1]).toBe(1);
    // 超新星は合体回数に含めない
    expect(d.mergesByTier[8]).toBe(0);
    expect(d.mergesByTier.reduce((a, b) => a + b, 0)).toBe(2);
    // 作った統計はそのまま検査を通る（次回の読み込みで捨てられない）
    expect(readRunDetail(d)).not.toBeNull();
  });
  it('出来事に連鎖が無いときは盤面の集計を使う', () => {
    const events = [event('merge', 5, { sourceTier: 0, resultTier: 1, scoreDelta: 100 })];
    const d = buildRunDetail(events, snapshot({ stats: { launches: 0, merges: 1, supernovas: 0, maxChain: 3 } }), META);
    expect(d.maxChain).toBe(3);
  });
  it('1 投も無ければ 1 投あたりの得点は 0', () => {
    const d = buildRunDetail([], snapshot({ score: 500 }), META);
    expect(d.launches).toBe(0);
    expect(d.scorePerLaunch).toBe(0);
  });
  it('overLimitEnd の無いままゲームが続いても、最後の tick まで数える', () => {
    const events = [event('overLimitStart', 10)];
    const d = buildRunDetail(events, snapshot({ tick: 70 }), META);
    expect(d.overLimitSeconds).toBeCloseTo(60 / TICK_HZ, 10);
  });
});

describe('壊れた入力を通さない', () => {
  it('無限・非整数・範囲外の値は落とすか丸め、出来事そのものは数える', () => {
    const events = [
      event('merge', 5, { sourceTier: 0, chain: 2.9, scoreDelta: 100.7 }),
      event('merge', 6, { sourceTier: asTier(9), chain: Infinity, scoreDelta: Infinity }),
      event('merge', 7, { sourceTier: asTier(-1) }),
      event('land', 8, { impactSpeed: NaN }),
      event('land', 9, { impactSpeed: Infinity }),
    ];
    const d = buildRunDetail(events, snapshot({ stats: { launches: 0, merges: 3, supernovas: 0, maxChain: 0 } }), META);
    expect(d.merges).toBe(3); // 合体そのものは数える
    expect(d.mergesByTier[0]).toBe(1); // Tier の内訳は範囲内だけ
    expect(d.mergesByTier.reduce((a, b) => a + b, 0)).toBe(1);
    expect(d.maxChain).toBe(2); // 2.9 は切り捨て、Infinity は落とす
    expect(d.maxSingleScore).toBe(100); // 100.7 は切り捨て、Infinity は落とす
    expect(d.maxImpactSpeed).toBe(0); // NaN・Infinity は落とす
    expect(readRunDetail(d)).not.toBeNull();
  });
  it('負や NaN の盤面の値は 0 にそろえ、Tier の範囲外は上端に丸める', () => {
    const d = buildRunDetail([], snapshot({
      tick: -50, score: -10, seed: NaN, bestTierThisRun: asTier(99),
      stats: { launches: 0, merges: 0, supernovas: 0, maxChain: Infinity },
    }), META);
    expect(d.seconds).toBe(0);
    expect(d.score).toBe(0);
    expect(d.seed).toBe(0);
    expect(d.bestTier).toBe(TIER_COUNT - 1);
    expect(d.maxChain).toBe(0);
    expect(readRunDetail(d)).not.toBeNull();
  });
  it('逆順の限界区間は負にせず 0 として数える', () => {
    const events = [event('overLimitStart', 200), event('overLimitEnd', 100)];
    const d = buildRunDetail(events, snapshot({ tick: 300 }), META);
    expect(d.overLimitSeconds).toBe(0);
    expect(d.overLimitEntries).toBe(1);
  });
  it('重複した overLimitStart は越え始めの回数も区間もずらさない', () => {
    const events = [event('overLimitStart', 10), event('overLimitStart', 20), event('overLimitEnd', 40)];
    const d = buildRunDetail(events, snapshot({ tick: 40 }), META);
    expect(d.overLimitEntries).toBe(1);
    expect(d.overLimitSeconds).toBeCloseTo(30 / TICK_HZ, 10);
  });
  it('start の無い overLimitEnd は無視する', () => {
    const d = buildRunDetail([event('overLimitEnd', 50)], snapshot({ tick: 100 }), META);
    expect(d.overLimitEntries).toBe(0);
    expect(d.overLimitSeconds).toBe(0);
  });
  it('読めない時刻の限界出来事は区間を汚さず、統計は保存できる形に残る', () => {
    const events = [
      event('overLimitStart', 10),
      event('overLimitEnd', 40), // 30 tick 有効
      event('overLimitStart', NaN), // 時刻が読めない → 出来事ごと捨てる
      event('overLimitStart', 100),
      event('overLimitEnd', Infinity), // 読めない end は「来ない」のと同じ → 区間は開いたまま
      event('overLimitEnd', -50), // 負は 0 に丸める → 100 - 0 は負なので 0 tick、区間は閉じる
      event('overLimitStart', 200), // 新しい区間（終了まで開きっぱなし）
    ];
    const d = buildRunDetail(events, snapshot({ tick: 300 }), META);
    expect(d.overLimitEntries).toBe(3); // tick 10, 100, 200
    // 有効な区間: 10〜40 の 30 tick + 200〜300 の 100 tick（100〜0 は負なので 0）
    expect(d.overLimitSeconds).toBeCloseTo(130 / TICK_HZ, 10);
    expect(Number.isFinite(d.overLimitSeconds)).toBe(true);
    expect(readRunDetail(d)).not.toBeNull();
  });
  it('盤面の集計と識別情報が欠けていても、検査を通る値に仕上げる', () => {
    const snap = snapshot({ stats: undefined });
    const d = buildRunDetail(
      [event('merge', 5, { chain: 4, scoreDelta: 50 })],
      snap,
      { id: 'meta', playedAt: 'not-a-date', gameVersion: '0.1.0' },
    );
    expect(d.maxChain).toBe(4); // 出来事側の連鎖は残る
    expect(d.playedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(readRunDetail(d)).not.toBeNull();
  });
});

describe('自動プレイとの照合', () => {
  it('自動プレイから作った統計が、出来事の数と盤面の集計に合う', () => {
    // 核の上に並べた Tier 0 2 体が最初の tick で合体する（必ず merge が出る）
    const auto = createAutoPlay(5, { bodies: [onCore(0, -1.6), onCore(0, -1.12)], queue: [0, 1, 2] });
    const events: GameEvent[] = [];
    for (let i = 0; i < 2400 && auto.sim.getSnapshot().phase === 'active'; i++) {
      events.push(...auto.step());
    }
    const snap = auto.sim.getSnapshot();
    const d = buildRunDetail(events, snap, { ...META, id: 'auto' });
    const count = (kind: GameEventKind) => events.filter((e) => e.kind === kind).length;
    expect(d.launches).toBeGreaterThan(0);
    expect(d.merges).toBeGreaterThan(0);
    expect(d.launches).toBe(count('launch'));
    expect(d.lands).toBe(count('land'));
    expect(d.merges).toBe(count('merge'));
    expect(d.supernovas).toBe(count('supernova'));
    expect(d.launches).toBe(snap.stats.launches);
    expect(d.merges).toBe(snap.stats.merges);
    expect(d.supernovas).toBe(snap.stats.supernovas);
    expect(d.maxChain).toBe(snap.stats.maxChain);
    expect(d.score).toBe(snap.score);
    expect(d.seconds).toBeCloseTo(snap.tick / TICK_HZ, 10);
    expect(d.bestTier).toBe(snap.bestTierThisRun);
    expect(d.overLimitSeconds).toBeGreaterThanOrEqual(0);
    expect(d.mergesByTier.reduce((a, b) => a + b, 0)).toBe(d.merges);
    expect(readRunDetail(d)).not.toBeNull();
  });
});
