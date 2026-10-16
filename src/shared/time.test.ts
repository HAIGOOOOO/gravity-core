import { describe, expect, it } from 'vitest';
import { HITSTOP_MAX_SECONDS, HITSTOP_RECOVER_SECONDS, SLOWMO_MAX_SECONDS, SLOWMO_MIN_SCALE } from '../game/constants';
import { createTimeGovernor } from './time';

const FRAME = 1 / 60;

describe('時間の速さの上限', () => {
  it('ふつうはそのまま 1', () => {
    expect(createTimeGovernor().apply(1, FRAME)).toBe(1);
  });

  it('止めるのは上限まで。超えたら一度ふつうに戻す', () => {
    const g = createTimeGovernor();
    let stoppedFor = 0;
    let t = 0;
    while (t < 1) {
      const s = g.apply(0, FRAME);
      t += FRAME;
      if (s === 0) stoppedFor += FRAME;
      else break;
    }
    expect(stoppedFor).toBeLessThanOrEqual(HITSTOP_MAX_SECONDS + FRAME);
    // 戻している間は、止めてと頼まれても動く
    let resumed = 0;
    for (let i = 0; i < Math.ceil(HITSTOP_RECOVER_SECONDS / FRAME) - 1; i++) resumed += g.apply(0, FRAME);
    expect(resumed).toBeGreaterThan(0);
  });

  it('スローは一番遅い速さより遅くならず、続けられる長さに上限がある', () => {
    const g = createTimeGovernor();
    expect(g.apply(0.1, FRAME)).toBe(SLOWMO_MIN_SCALE);
    // 続けて遅くしていられるのは上限まで。そこで一度ふつうに戻る
    let slow = FRAME;
    while (g.apply(0.5, FRAME) < 1) slow += FRAME;
    expect(slow).toBeLessThanOrEqual(SLOWMO_MAX_SECONDS + 2 * FRAME);
  });

  it('おかしな値は ふつうの速さとして扱う', () => {
    const g = createTimeGovernor();
    expect(g.apply(Number.NaN, FRAME)).toBe(1);
    expect(g.apply(5, FRAME)).toBe(1);
  });
});
