import { describe, expect, it } from 'vitest';
import { FLOAT_TEXT_CAP, PARTICLE_CAP, TIER_COLOR } from '../game/constants';
import { FLOAT_SECONDS } from './motion';
import { createEffectPool, RING_CAP } from './pool';

const COLOR = TIER_COLOR[0];

describe('演出の固定枠', () => {
  it('上限に達したら新規を断り、既存の枠や演出を置き換えない', () => {
    const pool = createEffectPool();
    for (let i = 0; i < PARTICLE_CAP; i++) expect(pool.particle(i, 0, 100, 0, 2, COLOR, 0.5)).toBe(true);
    for (let i = 0; i < RING_CAP; i++) expect(pool.ring(i, 0, 12, 90, 3, COLOR, 0.5)).toBe(true);
    for (let i = 0; i < FLOAT_TEXT_CAP; i++) expect(pool.text(i, 0, `＋${i}`, COLOR)).toBe(true);
    expect(pool.particle(999, 0, 0, 0, 2, COLOR, 0.5)).toBe(false);
    expect(pool.ring(999, 0, 12, 90, 3, COLOR, 0.5)).toBe(false);
    expect(pool.text(999, 0, '上限超過', COLOR)).toBe(false);
    expect(pool.particles[0].x).toBe(0);
    expect(pool.texts[0].text).toBe('＋0');
  });

  it('毎秒 100 回を 10 秒流しても、上限を守って終了後に全枠が空く', () => {
    const pool = createEffectPool();
    const particles = [...pool.particles];
    const rings = [...pool.rings];
    const texts = [...pool.texts];
    let droppedParticles = 0;
    let droppedTexts = 0;
    for (let event = 0; event < 1000; event++) {
      for (let i = 0; i < 14; i++) {
        if (!pool.particle(0, 0, 300, -200, 2, COLOR, 0.7)) droppedParticles++;
      }
      pool.ring(0, 0, 12, 90, 3, COLOR, 0.5);
      if (!pool.text(0, 0, '＋480', COLOR)) droppedTexts++;
      pool.update(0.01);
      expect(pool.particles.filter((p) => p.active).length).toBeLessThanOrEqual(PARTICLE_CAP);
      expect(pool.rings.filter((p) => p.active).length).toBeLessThanOrEqual(RING_CAP);
      expect(pool.texts.filter((p) => p.active).length).toBeLessThanOrEqual(FLOAT_TEXT_CAP);
    }
    expect(droppedParticles).toBeGreaterThan(0);
    expect(droppedTexts).toBeGreaterThan(0);
    pool.update(FLOAT_SECONDS);
    expect(pool.particles.some((p) => p.active)).toBe(false);
    expect(pool.rings.some((p) => p.active)).toBe(false);
    expect(pool.texts.some((p) => p.active)).toBe(false);
    for (let i = 0; i < PARTICLE_CAP; i++) expect(pool.particles[i]).toBe(particles[i]);
    for (let i = 0; i < RING_CAP; i++) expect(pool.rings[i]).toBe(rings[i]);
    for (let i = 0; i < FLOAT_TEXT_CAP; i++) expect(pool.texts[i]).toBe(texts[i]);
  });

  it('寿命が切れた枠を初期位置・寿命から再利用する', () => {
    const pool = createEffectPool();
    const particle = pool.particles[0];
    pool.particle(1, 2, 300, -100, 2, COLOR, 0.5);
    pool.update(0.5);
    expect(particle.active).toBe(false);
    pool.particle(30, 40, 0, 0, 4, TIER_COLOR[7], 0.8);
    expect(pool.particles[0]).toBe(particle);
    expect(particle).toMatchObject({ active: true, age: 0, lifetime: 0.8, x: 30, y: 40, vx: 0, vy: 0 });
  });

  it('clear は 3 種類を消し、浮き文字も同じ枠でやり直せる', () => {
    const pool = createEffectPool();
    const text = pool.texts[0];
    pool.particle(0, 0, 100, 0, 2, COLOR, 0.5);
    pool.ring(0, 0, 12, 90, 3, COLOR, 0.5);
    pool.text(0, 0, '＋480', COLOR);
    pool.update(0.4);
    pool.clear();
    expect(pool.particles.some((p) => p.active)).toBe(false);
    expect(pool.rings.some((p) => p.active)).toBe(false);
    expect(pool.texts.some((p) => p.active)).toBe(false);
    pool.text(5, 6, '＋100', COLOR);
    expect(pool.texts[0]).toBe(text);
    expect(text).toMatchObject({ active: true, age: 0, x: 5, y: 6, text: '＋100' });
    pool.update(1.19);
    expect(text.active).toBe(true);
    pool.update(0.02);
    expect(text.active).toBe(false);
  });
});
