import { describe, expect, it } from 'vitest';
import type { GameEvent, GameEventKind, GameSnapshot } from '../contracts/game';
import { createAutoPlay, onCore } from '../fixtures';
import { createRunRecorder } from './recorder';
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

describe('プレイ中の蓄積器', () => {
  it('分けて渡した出来事も、まとめて渡した列と同じ統計になる', () => {
    const events = [
      event('launch', 1),
      event('land', 30, { impactSpeed: 500 }),
      event('merge', 40, { sourceTier: 0, resultTier: 1, chain: 1, scoreDelta: 100 }),
      event('overLimitStart', 100),
      event('overLimitEnd', 220),
      event('gameOver', 300),
    ];
    const snap = snapshot({ tick: 300, phase: 'over', score: 500, stats: { launches: 1, merges: 1, supernovas: 0, maxChain: 1 } });
    const recorder = createRunRecorder();
    recorder.feed(events.slice(0, 3));
    recorder.feed([]); // 出来事の無い tick もある
    recorder.feed(events.slice(3));
    expect(recorder.finish(snap, META)).toEqual(buildRunDetail(events, snap, META));
  });
  it('finish は何度呼んでも同じ結果で、内部状態は変わらない', () => {
    const snap = snapshot({ tick: 120, phase: 'over' });
    const recorder = createRunRecorder();
    recorder.feed([event('launch', 1), event('overLimitStart', 10)]);
    const first = recorder.finish(snap, META);
    expect(recorder.finish(snap, META)).toEqual(first); // 開いたままの限界区間を二重に足さない
    expect(first.launches).toBe(1);
  });
  it('feed に配列でない物を渡しても落ちない', () => {
    const recorder = createRunRecorder();
    expect(() => recorder.feed(null as unknown as GameEvent[])).not.toThrow();
    expect(() => recorder.feed({ 0: event('launch', 1), length: 1 } as unknown as GameEvent[])).not.toThrow();
    const d = recorder.finish(snapshot({ tick: 60 }), META);
    expect(d.launches).toBe(0);
    expect(readRunDetail(d)).not.toBeNull();
  });
  it('reset で次のプレイに備える', () => {
    const recorder = createRunRecorder();
    recorder.feed([event('launch', 1), event('merge', 5, { sourceTier: 0, chain: 2, scoreDelta: 100 })]);
    recorder.reset();
    const d = recorder.finish(snapshot({ tick: 60 }), META);
    expect(d.launches).toBe(0);
    expect(d.merges).toBe(0);
    expect(d.maxChain).toBe(0);
    expect(d.mergesByTier.reduce((a, b) => a + b, 0)).toBe(0);
  });
  it('自動プレイに繋いでも、出来事の列から作った統計と一致し検査を通る', () => {
    const auto = createAutoPlay(5, { bodies: [onCore(0, -1.6), onCore(0, -1.12)], queue: [0, 1, 2] });
    const recorder = createRunRecorder();
    const collected: GameEvent[] = [];
    for (let i = 0; i < 2400 && auto.sim.getSnapshot().phase === 'active'; i++) {
      const events = auto.step();
      collected.push(...events);
      recorder.feed(events);
    }
    const snap = auto.sim.getSnapshot();
    const viaRecorder = recorder.finish(snap, { ...META, id: 'auto' });
    expect(viaRecorder).toEqual(buildRunDetail(collected, snap, { ...META, id: 'auto' }));
    expect(viaRecorder.merges).toBeGreaterThan(0);
    expect(readRunDetail(viaRecorder)).not.toBeNull();
  });
});
