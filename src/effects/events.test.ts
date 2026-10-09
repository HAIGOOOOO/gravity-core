import { describe, expect, it } from 'vitest';
import { sampleEvent } from '../fixtures';
import { TIER_COLOR } from '../game/constants';
import { createEventEffects } from './events';
import { createEffectPool } from './pool';

const theme = { bg: '', text: TIER_COLOR[8], chain: TIER_COLOR[3], danger: TIER_COLOR[4], cool: TIER_COLOR[0], font: 'sans-serif' };

describe('イベントの演出', () => {
  it('射出は輪だけ、着地は速度で粒子の量が変わる', () => {
    const pool = createEffectPool();
    const effects = createEventEffects(pool, theme);
    effects.handle(sampleEvent('launch'));
    expect(pool.rings.filter((p) => p.active)).toHaveLength(1);
    expect(pool.particles.some((p) => p.active)).toBe(false);
    pool.clear();
    effects.handle({ ...sampleEvent('land'), impactSpeed: 100 });
    const gentle = pool.particles.filter((p) => p.active).length;
    pool.clear();
    effects.handle({ ...sampleEvent('land'), impactSpeed: 600 });
    expect(pool.particles.filter((p) => p.active).length).toBeGreaterThan(gentle);
  });
  it('合体の火花は縮む段階の後に一度だけ出し、得点と連鎖はイベントの値を使う', () => {
    const pool = createEffectPool();
    const effects = createEventEffects(pool, theme);
    effects.handle({ ...sampleEvent('merge', 2, 0, 0, 3), scoreDelta: 330 });
    effects.update(0.07);
    expect(pool.particles.some((p) => p.active)).toBe(false);
    effects.update(0.02);
    const particles = pool.particles.filter((p) => p.active).length;
    expect(particles).toBeGreaterThan(60);
    expect(pool.texts.some((p) => p.active && p.text === '＋330')).toBe(true);
    expect(pool.texts.some((p) => p.active && p.text === '連鎖 ×3')).toBe(true);
    effects.update(0.05);
    expect(pool.particles.filter((p) => p.active)).toHaveLength(particles);
  });
  it('超新星は四重の輪と 240 粒、熱量は受け取った値を表示する', () => {
    const pool = createEffectPool();
    const effects = createEventEffects(pool, theme);
    effects.handle({ ...sampleEvent('supernova'), heatDelta: -17 });
    effects.update(0.11);
    expect(pool.rings.filter((p) => p.active)).toHaveLength(4);
    expect(pool.particles.filter((p) => p.active)).toHaveLength(240);
    expect(pool.texts.some((p) => p.text === '核熱量 −17')).toBe(true);
  });
  it('動きを減らしても得点を残し、粒子と遅延を省く', () => {
    const pool = createEffectPool();
    const effects = createEventEffects(pool, theme);
    effects.setReduced(true);
    effects.handle(sampleEvent('merge'));
    expect(pool.particles.some((p) => p.active)).toBe(false);
    expect(pool.rings.filter((p) => p.active).every((p) => p.stationary)).toBe(true);
    expect(pool.texts.some((p) => p.active)).toBe(true);
  });
  it('clear した後に保留中の火花を出さない', () => {
    const pool = createEffectPool();
    const effects = createEventEffects(pool, theme);
    effects.handle(sampleEvent('merge'));
    effects.clear();
    effects.update(1);
    expect(pool.particles.some((p) => p.active)).toBe(false);
  });
});
