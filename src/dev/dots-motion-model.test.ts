import { describe, expect, it } from 'vitest';
import { bodyRadius, sampleDotsMotion } from './dots-motion-model';

describe('点の動きの比較に使う共通場面', () => {
  it('6体から始め、同じ合体の前後で得点と熱を更新する', () => {
    const waiting = sampleDotsMotion('merge', 0);
    expect(waiting.bodies).toHaveLength(6);
    expect(2 * bodyRadius(0)).toBeGreaterThanOrEqual(6);
    const contact = sampleDotsMotion('merge', .96);
    expect(contact.event).toMatchObject({ stage: 1, nova: false });
    expect(contact.points).toBe(waiting.points + 100);
    expect(contact.heat).toBe(waiting.heat - 2);
    const end = sampleDotsMotion('merge', 3);
    expect(end.bodies).toHaveLength(5);
    expect(end.event).toBeNull();
  });

  it('5連鎖は5つの接触、超新星は合体後の天体を残さない', () => {
    expect([.53, .96, 1.39, 1.82, 2.25].map(t => sampleDotsMotion('chain', t).event?.stage)).toEqual([1, 2, 3, 4, 5]);
    expect(sampleDotsMotion('chain', 3).bodies.map(body => body.tier)).toEqual([5]);
    expect(sampleDotsMotion('nova', 1.35).event?.nova).toBe(true);
    expect(sampleDotsMotion('nova', 3).bodies).toHaveLength(4);
    expect(sampleDotsMotion('nova', 3).heat).toBe(46);
  });
});
