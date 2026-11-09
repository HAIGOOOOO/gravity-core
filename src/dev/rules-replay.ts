import type { GameEvent, GameSnapshot } from '../contracts/game';
import { DT, TICK_HZ } from '../game/constants';

export type LessonFrame = Readonly<{
  prev: GameSnapshot; curr: GameSnapshot;
  events: readonly GameEvent[]; contacts: readonly GameEvent[]; maxChain: number;
}>;
type ReviewPhase = 'idle' | 'playing' | 'contact' | 'ended';
const MAX_FRAMES = 10 * TICK_HZ;
export const LESSON_REPLAY_SPEED = 1 / 4;

/** 教材の実測盤面だけを保持する。見返しても元の計算や成績を進めない。 */
export function createLessonReplay(initial: GameSnapshot) {
  const frames: LessonFrame[] = [{ prev: initial, curr: initial, events: [], contacts: [], maxChain: 0 }];
  let cursor = 0, contactIndex = -1, ordinal = 0, phase: ReviewPhase = 'idle', bank = 0, contactCount = 0;
  return {
    record(prev: GameSnapshot, curr: GameSnapshot, events: readonly GameEvent[], maxChain = 0) {
      const contacts = events.filter(e => e.kind === 'merge' || e.kind === 'supernova');
      frames.push({ prev, curr, events: [...events], contacts, maxChain });
      contactCount += contacts.length;
      if (frames.length > MAX_FRAMES) contactCount -= frames.shift()!.contacts.length;
    },
    start() {
      cursor = 0; contactIndex = -1; bank = 0;
      phase = frames.length > 1 ? 'playing' : 'ended';
    },
    contact(direction: 1 | -1 = 1) {
      if (contactCount === 0) return;
      // 同じtickで複数組が合体しても、出来事の順に一組ずつ確認する。
      if (direction === -1) {
        if (phase !== 'contact' || ordinal <= 1) return;
        if (contactIndex > 0) contactIndex--;
        else {
          while (--cursor > 0 && !frames[cursor]!.contacts.length) { /* 前の合体を探す */ }
          contactIndex = frames[cursor]!.contacts.length - 1;
        }
      } else if (phase === 'contact' && contactIndex + 1 < frames[cursor]!.contacts.length) contactIndex++;
      else {
        const next = frames.findIndex((frame, n) => (phase === 'idle' || n > cursor) && frame.contacts.length > 0);
        cursor = next < 0 ? frames.findIndex(frame => frame.contacts.length > 0) : next;
        contactIndex = 0;
      }
      ordinal = frames.slice(0, cursor).reduce((sum, frame) => sum + frame.contacts.length, contactIndex + 1);
      phase = 'contact'; bank = 0;
    },
    stop() { phase = 'idle'; bank = 0; },
    advance(seconds: number): readonly GameEvent[] {
      const events: GameEvent[] = [];
      if (phase !== 'playing') return events;
      bank += seconds * LESSON_REPLAY_SPEED;
      while (bank >= DT && cursor < frames.length - 1) {
        bank -= DT; cursor++; events.push(...frames[cursor]!.events);
      }
      if (cursor === frames.length - 1) phase = 'ended';
      return events;
    },
    read: () => {
      const frame = phase === 'idle' ? null : frames[cursor]!;
      return { frame, phase, playing: phase === 'playing', hasContact: contactCount > 0,
        contactCount, contactNumber: phase === 'contact' ? ordinal : 0,
        focus: phase === 'contact' ? frame!.contacts[contactIndex] : frame?.contacts[0],
        seconds: frame ? (frame.curr.tick - frames[0]!.curr.tick) / TICK_HZ : 0 };
    },
  };
}
