import { describe, expect, it } from 'vitest';
import { QUEUE_BAG_SIZE } from './constants';
import { createRng, createRngFromState } from './rng';
import { createTierBag } from './spawner';

describe('次の天体の袋', () => {
  it.each([
    [0, [14, 6]], [2, [9, 7, 4]], [3, [7, 6, 4, 3]], [4, [6, 5, 4, 3, 2]],
  ] as const)('到達Tier%dの各袋の個数が固定される', (best, counts) => {
    const bag = createTierBag(createRng(72));
    for (let cycle = 0; cycle < 5; cycle++) {
      const contents = Array.from({ length: QUEUE_BAG_SIZE }, () => bag.draw(best));
      expect(counts.map((_, tier) => contents.filter((v) => v === tier).length)).toEqual(counts);
      expect(bag.exportState()).toHaveLength(0);
    }
  });
  it('途中で到達Tierが上がっても、古い袋を引き切ってから新しい袋になる', () => {
    const bag = createTierBag(createRng(9));
    const first = [bag.draw(0), ...Array.from({ length: QUEUE_BAG_SIZE - 1 }, () => bag.draw(4))];
    expect(first.filter((t) => t === 0)).toHaveLength(14);
    expect(first.filter((t) => t === 1)).toHaveLength(6);
    const next = Array.from({ length: QUEUE_BAG_SIZE }, () => bag.draw(4));
    expect(next.filter((t) => t === 4)).toHaveLength(2);
  });
  it('袋と乱数を復元すると、袋をまたいでも同じ続きになり、保存配列を共有しない', () => {
    const rng = createRng(8), a = createTierBag(rng);
    for (let i = 0; i < 7; i++) a.draw(3);
    const saved = a.exportState(), copy = [...saved];
    const b = createTierBag(createRngFromState(rng.state()), saved);
    expect(Array.from({ length: 80 }, () => a.draw(4))).toEqual(Array.from({ length: 80 }, () => b.draw(4)));
    expect(saved).toEqual(copy);
  });
  it('異なる種で順番は変わる', () => {
    const a = createTierBag(createRng(1)), b = createTierBag(createRng(2));
    expect(Array.from({ length: 20 }, () => a.draw(4))).not.toEqual(Array.from({ length: 20 }, () => b.draw(4)));
  });
});
