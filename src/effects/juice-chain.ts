import type { GameEvent } from '../contracts/game';
import { CHAIN_WINDOW_SECONDS, TICK_HZ } from '../game/constants';

/** 最後の出来事ではなく、連鎖へ使われた天体の誕生地点を結ぶ。 */
export function createChainOrigins() {
  const origins = new Map<number, { x: number; y: number; tick: number }>();
  return {
    receive(event: GameEvent): { x: number; y: number } {
      for (const [id, origin] of origins) if (event.tick - origin.tick > CHAIN_WINDOW_SECONDS * TICK_HZ) origins.delete(id);
      const ids = event.bodyIds ?? [];
      const parent = (event.chain ?? 1) > 1 ? origins.get(ids[0]) ?? origins.get(ids[1]) : undefined;
      const location = { x: event.x ?? 0, y: event.y ?? 0 };
      origins.delete(ids[0]); origins.delete(ids[1]);
      if (event.kind === 'merge' && ids[2] !== undefined) origins.set(ids[2], { ...location, tick: event.tick });
      if (origins.size > 48) origins.delete(origins.keys().next().value!);
      return parent ? { x: parent.x, y: parent.y } : location;
    },
    clear(): void { origins.clear(); },
  };
}
