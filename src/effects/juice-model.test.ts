import { describe, expect, it } from 'vitest';
import { blankBurst, burstFromEvent, juiceRandom, juiceTimeScale, layerCount, releaseTime, visualAge } from './juice-model';

describe('多層の合体の構成', () => {
  it('連鎖で構成が増え、最小22層・最大44層になる', () => {
    expect([1, 2, 3, 4, 5].map(n => layerCount(n))).toEqual([22, 27, 32, 37, 44]);
    expect(layerCount(1, true)).toBe(44);
  });
  it('同じseedの粒は再現でき、出来事が違うと配置が変わる', () => {
    const a = Array.from({ length: 24 }, (_, n) => juiceRandom(10, n));
    expect(a).toEqual(Array.from({ length: 24 }, (_, n) => juiceRandom(10, n)));
    expect(a).not.toEqual(Array.from({ length: 24 }, (_, n) => juiceRandom(11, n)));
    expect(a.every(n => n >= 0 && n < 1)).toBe(true);
  });
  it('小合体は止めず、大合体も止める長さを足し合わせない形で返す', () => {
    const b = { ...blankBurst(), active: true, age: 0.07 };
    expect(juiceTimeScale(b)).toBe(1);
    b.chain = 5; b.age = 0.13;
    expect(juiceTimeScale(b)).toBe(0);
    expect(juiceTimeScale(b, true)).toBe(1);
    b.age = 0.4;
    expect(juiceTimeScale(b)).toBe(1);
  });
  it('段が上がると溜めが伸び、解放の瞬間を同じ描画位相へそろえる', () => {
    const b = blankBurst();
    const releases = [1, 2, 3, 4, 5].map(chain => releaseTime({ ...b, chain }));
    expect(releases).toEqual([0.065, 0.075, 0.1, 0.125, 0.16]);
    for (const chain of [1, 3, 5]) {
      const age = releaseTime({ ...b, chain });
      expect(visualAge({ ...b, chain, age })).toBeCloseTo(0.075);
      expect(visualAge({ ...b, chain, age: age + 0.2 })).toBeCloseTo(0.275);
    }
  });
  it('最大段・超新星の停止を67ms以内とし、解放後は必ず通常時間へ戻す', () => {
    for (const nova of [false, true]) {
      const b = { ...blankBurst(), active: true, chain: 5, nova };
      const stopped = Array.from({ length: 1000 }, (_, i) => juiceTimeScale({ ...b, age: i / 1000 })).filter(n => n === 0).length;
      expect(stopped).toBeLessThanOrEqual(67); expect(stopped).toBeGreaterThanOrEqual(49);
      expect(juiceTimeScale({ ...b, age: 0.5 })).toBe(1);
    }
  });
  it('得点と合体の階級は受け取ったイベントだけから作る', () => {
    const b = burstFromEvent({ kind: 'merge', sequence: 100, tick: 3, x: 42, y: -50,
      sourceTier: 2, resultTier: 3, scoreDelta: 1234, chain: 3 }, { x: -30, y: 40 });
    expect([b.score, b.tier, b.result, b.px]).toEqual([1234, 2, 3, -30]);
  });
  it('演出の段は5で止めても、表示する実際の連鎖数は6以降を保持する', () => {
    const b = burstFromEvent({ kind: 'merge', sequence: 1, tick: 1, chain: 7, chainStage: 5, bodyIds: [3, 4, 5] }, { x: 0, y: 0 });
    expect(b.chain).toBe(5); expect(b.chainCount).toBe(7); expect(b.resultId).toBe(5);
  });
});
