import { describe, expect, it } from 'vitest';
import { contrastRatio, LOOK_PALETTES } from './look-palette';

describe('見本の文字のコントラスト', () => {
  it('白黒は21、同じ色は1、前景と背景を逆にしても同じ', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#123456', '#123456')).toBe(1);
    expect(contrastRatio('#123456', '#abcdef')).toBe(contrastRatio('#abcdef', '#123456'));
  });
  it.each(LOOK_PALETTES)('$id の本文と補足を4.5以上にする', palette => {
    expect(contrastRatio(palette.ink, palette.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.muted, palette.bg)).toBeGreaterThanOrEqual(4.5);
  });
});
