import { describe, expect, it } from 'vitest';
import { TIER_COLOR } from '../game/constants';
import { createPresentation, endProgress, shakeSize } from './presentation';

const theme = { bg: '', text: TIER_COLOR[8], chain: TIER_COLOR[3], danger: TIER_COLOR[4], cool: TIER_COLOR[0], font: 'sans-serif' };

describe('揺れと終了', () => {
  it('Tier と超新星の揺れ幅、0.55 秒の終了時間を守る', () => {
    expect(shakeSize(3, false)).toBe(0);
    expect(shakeSize(4, false)).toBe(2);
    expect(shakeSize(6, false)).toBe(4);
    expect(shakeSize(8, true)).toBe(8);
    expect(endProgress(0)).toBe(0);
    expect(endProgress(0.55)).toBe(1);
  });
  it('連打しても元の transform を復元する', () => {
    const target = { style: { transform: 'scale(0.9)' } } as unknown as HTMLElement;
    const presentation = createPresentation(target, theme);
    presentation.shake(4, false);
    presentation.update(0.03);
    expect(target.style.transform).toContain('translate(');
    presentation.shake(8, true);
    presentation.update(0.04);
    presentation.update(0.07);
    expect(target.style.transform).toBe('scale(0.9)');
  });
  it('clear と動きを減らす設定が揺れを即座に止め、位置を戻す', () => {
    const target = { style: { transform: '' } } as unknown as HTMLElement;
    const presentation = createPresentation(target, theme);
    presentation.shake(8, true);
    presentation.update(0.01);
    presentation.clear();
    expect(target.style.transform).toBe('');
    presentation.shake(8, true);
    presentation.update(0.01);
    presentation.setReduced(true);
    expect(target.style.transform).toBe('');
    presentation.shake(8, true);
    presentation.update(0.01);
    expect(target.style.transform).toBe('');
  });
});
