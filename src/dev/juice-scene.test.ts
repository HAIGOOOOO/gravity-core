import { describe, expect, it } from 'vitest';
import { createJuiceScene } from './juice-scene';

describe('実計算による演出見本', () => {
  it('合体する2体だけを消し、イベントで生まれた1体を対応付ける', () => {
    const scene = createJuiceScene(2, 1);
    expect(scene.sources.map(b => b.id)).toEqual(scene.event.bodyIds!.slice(0, 2));
    expect(scene.result!.id).toBe(scene.event.bodyIds![2]);
    expect(scene.result!.tier).toBe(3);
    expect(scene.background.bodies).toHaveLength(3);
    expect(scene.background.bodies.some(b => b.id === scene.result!.id)).toBe(false);
  });
  it('超新星には誕生した天体を捏造しない', () => {
    const scene = createJuiceScene(8, 5);
    expect(scene.event.kind).toBe('supernova');
    expect(scene.sources).toHaveLength(2);
    expect(scene.result).toBeUndefined();
    expect(scene.background.bodies).toHaveLength(2);
  });
  it('連鎖数を比べても合体の位置と参加する天体は変わらない', () => {
    const first = createJuiceScene(2, 1), fifth = createJuiceScene(2, 5);
    expect(fifth.sources).toEqual(first.sources);
    expect(fifth.event.x).toBe(first.event.x);
    expect(fifth.event.y).toBe(first.event.y);
    expect(fifth.event.scoreDelta).toBeGreaterThan(first.event.scoreDelta!);
  });
});
