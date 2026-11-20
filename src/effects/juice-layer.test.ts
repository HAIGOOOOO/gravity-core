import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../contracts/game';
import { createJuiceLayer } from './juice-layer';
import { impactProfile } from './impact-model';
import { makeJuiceBurst } from '../render/juice-model';

const merge: GameEvent = { kind: 'merge', tick: 1, sequence: 1, x: 0, y: -100,
  sourceTier: 4, resultTier: 5, scoreDelta: 100, chain: 5 };

describe('本体の事件の時間制御', () => {
  it('本体と同じ層で停止・スロー・通常への復帰を返す', () => {
    const effects = createJuiceLayer();
    effects.handle(merge); effects.update(.10);
    expect(effects.timeScale()).toBe(0);
    effects.update(.10); expect(effects.timeScale()).toBe(.3);
    effects.setReduced(true); expect(effects.timeScale()).toBe(1);
    effects.setReduced(false); expect(effects.timeScale()).toBe(.3);
    effects.update(2); expect(effects.timeScale()).toBe(1);
  });

  it('同じtickの弱い合体で超新星の時間を消さず、clearでは解除する', () => {
    const effects = createJuiceLayer();
    effects.handle({ ...merge, kind: 'supernova', sourceTier: 8 });
    effects.handle({ ...merge, chain: 1, sourceTier: 0 });
    effects.update(.1); expect(effects.timeScale()).toBe(0);
    effects.clear(); expect(effects.timeScale()).toBe(1);
  });

  it('5連鎖と超新星は段1より届く距離、余韻、点の数が大きい', () => {
    const profile = (chain: number) => impactProfile(makeJuiceBurst({ ...merge, chain }, 'fracture')!);
    const first = profile(1), last = profile(5);
    expect(last.duration).toBeGreaterThan(first.duration);
    expect(last.particles).toBeGreaterThan(first.particles);
    expect(last.waves).toBeGreaterThan(first.waves);
    expect(last.reach).toBeGreaterThan(first.reach);
    const nova = impactProfile(makeJuiceBurst({ ...merge, kind: 'supernova' }, 'fracture')!);
    expect(nova.duration).toBeGreaterThanOrEqual(1.5);
    expect(nova.reach).toBeGreaterThan(last.reach);
  });
});
