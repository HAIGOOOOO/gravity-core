import { describe, expect, it } from 'vitest';
import { sampleEvent } from '../fixtures';
import { HITSTOP_MAX_SECONDS } from '../game/constants';
import { makeJuiceBurst } from './juice-model';
import { createJuiceTiming, juiceMatterTime, juiceTimeScale, juiceView } from './juice-timing';

describe('合体の実時間と天体の時間', () => {
  const burst = makeJuiceBurst(sampleEvent('merge', 2, 135, -100, 5), 'fracture')!;
  it('停止中も実時間の演出は進み、天体の時間だけ同じ位置を保つ', () => {
    expect(juiceMatterTime(burst, .10)).toBeCloseTo(juiceMatterTime(burst, .15));
    expect(juiceTimeScale(burst, .12)).toBe(0);
    let longest = 0, held = 0, previous = 0;
    for (let i = 0; i <= 3000; i++) {
      const age = i / 1000, time = juiceMatterTime(burst, age);
      expect(time).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = time;
      held = juiceTimeScale(burst, age) === 0 ? held + .001 : 0;
      longest = Math.max(longest, held);
    }
    expect(longest).toBeLessThanOrEqual(HITSTOP_MAX_SECONDS);
    expect(juiceTimeScale(burst, 2)).toBe(1);
  });
  it('減らす設定とclearで停止・寄り・揺れを残さない', () => {
    const clock = createJuiceTiming(); clock.start(burst); clock.update(.12);
    expect(clock.timeScale()).toBe(0);
    clock.setReducedMotion(true); expect(clock.timeScale()).toBe(1);
    expect(juiceView(burst, .12, true)).toEqual({ zoom: 1, x: 0, y: 0 });
    clock.setReducedMotion(false); clock.clear(); expect(clock.timeScale()).toBe(1);
  });
  it('小さい合体を揺らさず、大きい合体も寄り3%・ずれ2%以内に収める', () => {
    const small = makeJuiceBurst(sampleEvent('merge', 0, 135, -100, 1), 'fracture')!;
    expect(juiceView(small, .16)).toEqual({ zoom: 1, x: 0, y: 0 });
    for (let i = 0; i < 120; i++) {
      const view = juiceView(burst, i / 60);
      expect(view.zoom).toBeLessThanOrEqual(1.03);
      expect(Math.hypot(view.x, view.y)).toBeLessThanOrEqual(9.6);
    }
  });
});
