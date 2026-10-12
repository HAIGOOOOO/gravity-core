import { describe, expect, it } from 'vitest';
import {
  dampedTravel, dampedVelocity, fade, FLOAT_RISE, FLOAT_SECONDS,
  floatOffset, lifeProgress, ringRadius, safeDelta,
} from './motion';

describe('演出の寿命と減衰', () => {
  it('浮き文字は 1.2 秒で 24 上に移動し、寿命外で行き過ぎない', () => {
    expect(FLOAT_SECONDS).toBe(1.2);
    expect(FLOAT_RISE).toBe(24);
    expect(floatOffset(0)).toBeCloseTo(0);
    expect(floatOffset(0.6)).toBe(-12);
    expect(floatOffset(1.2)).toBe(-24);
    expect(floatOffset(5)).toBe(-24);
    expect(floatOffset(-1)).toBeCloseTo(0);
  });

  it('寿命の終わりで不透明度がゼロになり、負の不透明度を返さない', () => {
    expect(fade(0, 0.5)).toBe(1);
    expect(fade(0.25, 0.5)).toBe(0.25);
    expect(fade(0.5, 0.5)).toBe(0);
    expect(fade(1, 0.5)).toBe(0);
    expect(lifeProgress(0, 0)).toBe(1);
  });

  it('輪は始点と終点を守り、終わりに近づくほど遅く広がる', () => {
    expect(ringRadius(12, 90, -1)).toBe(12);
    expect(ringRadius(12, 90, 2)).toBe(90);
    const early = ringRadius(12, 90, 0.25) - ringRadius(12, 90, 0);
    const late = ringRadius(12, 90, 1) - ringRadius(12, 90, 0.75);
    expect(early).toBeGreaterThan(late);
  });

  it('同じ秒数なら、フレームを分けても粒子の速度と位置が一致する', () => {
    const velocity = -300;
    const first = 0.13;
    const second = 0.27;
    const afterFirst = dampedVelocity(velocity, first);
    expect(dampedVelocity(afterFirst, second)).toBeCloseTo(dampedVelocity(velocity, first + second));
    expect(dampedTravel(velocity, first) + dampedTravel(afterFirst, second))
      .toBeCloseTo(dampedTravel(velocity, first + second));
  });

  it('無効な経過時間で演出を巻き戻したり壊したりしない', () => {
    for (const seconds of [-1, NaN, Infinity]) {
      expect(safeDelta(seconds)).toBe(0);
      expect(dampedVelocity(200, seconds)).toBe(200);
      expect(dampedTravel(200, seconds)).toBe(0);
    }
  });
});
