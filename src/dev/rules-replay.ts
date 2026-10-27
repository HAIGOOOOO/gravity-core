import type { GameEvent, GameSnapshot } from '../contracts/game';
import { DT, TICK_HZ } from '../game/constants';

export type LessonFrame = Readonly<{ prev: GameSnapshot; curr: GameSnapshot; events: readonly GameEvent[] }>;
const MAX_FRAMES = 10 * TICK_HZ;

/** 教材の実測盤面だけを保持する。見返しても元の計算や成績を進めない。 */
export function createLessonReplay(initial: GameSnapshot) {
  const frames: LessonFrame[] = [{ prev: initial, curr: initial, events: [] }];
  let cursor: number | null = null, playing = false, bank = 0;
  return {
    record(prev: GameSnapshot, curr: GameSnapshot, events: readonly GameEvent[]) {
      frames.push({ prev, curr, events: [...events] });
      if (frames.length > MAX_FRAMES) frames.shift();
    },
    start() { cursor = 0; playing = true; bank = 0; },
    contact() {
      const contacts = frames.flatMap((f, n) => f.events.some(e => e.kind === 'merge' || e.kind === 'supernova') ? [n] : []);
      if (contacts.length === 0) return;
      cursor = contacts.find(n => n > (cursor ?? -1)) ?? contacts[0]!; playing = false; bank = 0;
    },
    stop() { cursor = null; playing = false; bank = 0; },
    advance(seconds: number): readonly GameEvent[] {
      const events: GameEvent[] = [];
      if (!playing || cursor === null) return events;
      bank += seconds / 4;
      while (bank >= DT && cursor < frames.length - 1) {
        bank -= DT; cursor++; events.push(...frames[cursor]!.events);
      }
      if (cursor === frames.length - 1) playing = false;
      return events;
    },
    read: () => ({ frame: cursor === null ? null : frames[cursor]!, playing,
      hasContact: frames.some(f => f.events.some(e => e.kind === 'merge' || e.kind === 'supernova')),
      seconds: cursor === null ? 0 : (frames[cursor]!.curr.tick - initial.tick) / TICK_HZ }),
  };
}
