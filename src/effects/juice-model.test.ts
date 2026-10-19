import { describe, expect, it } from 'vitest';
import { blankBurst, burstFromEvent, juiceRandom, juiceTimeScale, layerCount } from './juice-model';

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
    b.chain = 5;
    expect(juiceTimeScale(b)).toBe(0);
    expect(juiceTimeScale(b, true)).toBe(1);
    b.age = 0.3;
    expect(juiceTimeScale(b)).toBe(1);
  });
  it('得点と合体の階級は受け取ったイベントだけから作る', () => {
    const b = burstFromEvent({ kind: 'merge', sequence: 100, tick: 3, x: 42, y: -50,
      sourceTier: 2, resultTier: 3, scoreDelta: 1234, chain: 3 }, { x: -30, y: 40 });
    expect([b.score, b.tier, b.result, b.px]).toEqual([1234, 2, 3, -30]);
  });
});
