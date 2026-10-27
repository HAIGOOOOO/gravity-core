import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../contracts/game';
import { CHAIN_WINDOW_SECONDS, TICK_HZ } from '../game/constants';
import { createChainOrigins } from './juice-chain';

const event = (ids: number[], x: number, tick: number, chain = 1): GameEvent =>
  ({ kind: 'merge', sequence: tick, tick, bodyIds: ids, x, y: 0, chain });
describe('連鎖が実際につながった地点', () => {
  it('間に無関係の合体が入っても、使われた天体から線を引く', () => {
    const origins = createChainOrigins();
    origins.receive(event([1, 2, 3], 40, 0));
    origins.receive(event([4, 5, 6], -90, 1));
    expect(origins.receive(event([3, 7, 8], 60, 2, 2))).toEqual({ x: 40, y: 0 });
  });
  it('期限後とclear後は古い地点へ結ばない', () => {
    const origins = createChainOrigins(); origins.receive(event([1, 2, 3], 40, 0));
    expect(origins.receive(event([3, 4, 5], 60, CHAIN_WINDOW_SECONDS * TICK_HZ + 1, 2)).x).toBe(60);
    origins.clear(); expect(origins.receive(event([5, 6, 7], 80, 400, 3)).x).toBe(80);
  });
});
