import { describe, expect, it } from 'vitest';
import { impactStrength, mergeProfile, PARTICLE_BOOST, signedNumber } from './appearance';

describe('出来事ごとの強さ', () => {
  it('基準の粒子量を 5 倍にし、Tier・連鎖で輪と火花を増やす', () => {
    expect(PARTICLE_BOOST).toBe(5);
    expect(mergeProfile(0, 1).particles).toBe(40);
    const low = mergeProfile(1, 1);
    const high = mergeProfile(8, 1);
    const chain = mergeProfile(8, 5);
    expect(high.radius).toBeGreaterThan(low.radius);
    expect(high.seconds).toBeGreaterThan(low.seconds);
    expect(high.particles).toBeGreaterThan(low.particles);
    expect(chain.rings).toBeGreaterThan(high.rings);
    expect(chain.particles).toBeGreaterThan(high.particles);
    expect(mergeProfile(8, 1, true).particles).toBeGreaterThan(chain.particles);
  });
  it('着地の強さは正規化し、入力が大きくても際限なく増えない', () => {
    expect(impactStrength(-100)).toBe(0);
    expect(impactStrength(200)).toBeLessThan(impactStrength(600));
    expect(impactStrength(100000)).toBe(1);
  });
  it('イベントから受け取った得点・熱量の符号を表示する', () => {
    expect(signedNumber(45000)).toBe('＋45,000');
    expect(signedNumber(-40)).toBe('−40');
  });
});
