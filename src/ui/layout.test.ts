import { describe, expect, it } from 'vitest';
import { measureLayout } from './layout';

describe('盤面と情報パネルの配置', () => {
  it.each([
    [1280, 720, 672, 'desktop'],
    [900, 600, 548, 'desktop'],
    [360, 640, 344, 'portrait'],
    [640, 360, 344, 'landscape'],
  ])('%i × %i の盤面が収まる', (width, height, size, kind) => {
    expect(measureLayout(width, height)).toEqual({ size, kind });
  });
  it('縦長と正方形では上下の帯を使う', () => {
    expect(measureLayout(1000, 1200).kind).toBe('portrait');
    expect(measureLayout(900, 900).kind).toBe('portrait');
  });
  it('安全領域を高さから引き、最小サイズを守る', () => {
    expect(measureLayout(360, 480, 40).size).toBe(296);
    expect(measureLayout(300, 320, 20).size).toBe(240);
  });
});
