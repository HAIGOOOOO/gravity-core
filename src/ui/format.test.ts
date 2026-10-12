import { expect, it } from 'vitest';
import { durationLabel } from './format';
it('時間は分:秒、負や不正な値は0:00にする', () => {
  expect(durationLabel(69.9)).toBe('1:09');
  expect(durationLabel(3601)).toBe('60:01');
  expect(durationLabel(-1)).toBe('0:00');
  expect(durationLabel(NaN)).toBe('0:00');
});
