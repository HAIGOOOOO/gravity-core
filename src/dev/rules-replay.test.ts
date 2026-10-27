import { expect, it } from 'vitest';
import { createLessonReplay } from './rules-replay';
import { createRuleSession } from './rules-session';
import { dropAt } from '../fixtures';
import { DT, TICK_HZ } from '../game/constants';

it('実際の合体へ戻り、4分の1速で全出来事を一度ずつ見返しても元の結果を変えない', () => {
  const lesson = createRuleSession('learn'), replay = lesson.review;
  lesson.launch(dropAt(-Math.PI / 2));
  const events = [];
  while (!lesson.read().finished) events.push(...lesson.step());
  const final = lesson.read().curr;
  replay.contact(); const contact = replay.read().frame!;
  expect(contact.events.some(e => e.kind === 'merge')).toBe(true);
  expect(contact.curr.tick).toBeLessThan(final.tick);
  replay.start(); const seen = [];
  for (let n = 0; replay.read().playing && n < 5 * TICK_HZ; n++) seen.push(...replay.advance(4 * DT));
  expect(seen).toEqual(events);
  expect(replay.read().frame!.curr).toEqual(final);
  expect(lesson.read().curr).toBe(final);
  replay.stop(); expect(replay.read().frame).toBeNull();
});

it('長い練習でも直近10秒までに保ち、停止中の再生は進まない', () => {
  const initial = createRuleSession().before, replay = createLessonReplay(initial);
  for (let tick = 1; tick <= 12 * TICK_HZ; tick++) replay.record(initial, { ...initial, tick }, []);
  replay.start(); expect(replay.read().frame!.curr.tick).toBe(2 * TICK_HZ + 1);
  replay.stop(); replay.advance(10); expect(replay.read().frame).toBeNull();
});
