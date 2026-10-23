import { describe, expect, it } from 'vitest';
import { createCoolingReceipt } from './cooling';

describe('実際の冷却を見せる表示', () => {
  it('0の合体を盛らず、同時の合体は実差分を足して一枚へまとめる', () => {
    const cue = createCoolingReceipt();
    cue.handle({ kind: 'merge', sequence: 0, tick: 1, chain: 5, heatDelta: 0 });
    expect(cue.value).toBe(0);
    cue.handle({ kind: 'merge', sequence: 1, tick: 2, heatDelta: -8 });
    cue.handle({ kind: 'merge', sequence: 2, tick: 2, heatDelta: -1 });
    expect(cue.value).toBe(9);
    cue.handle({ kind: 'merge', sequence: 2, tick: 2, heatDelta: -1 });
    expect(cue.value).toBe(9);
  });
  it('離れた合体と超新星を混ぜず、停止・やり直しで残さない', () => {
    const cue = createCoolingReceipt();
    cue.handle({ kind: 'merge', sequence: 1, tick: 1, heatDelta: -2 });
    cue.update(0.3); cue.handle({ kind: 'supernova', sequence: 2, tick: 40, heatDelta: -5 });
    expect(cue.value).toBe(5);
    cue.update(1.5); expect(cue.value).toBe(0);
    cue.clear(); cue.handle({ kind: 'merge', sequence: 0, tick: 0, heatDelta: -2 });
    expect(cue.value).toBe(2);
    cue.clear(); expect(cue.value).toBe(0);
  });
});
