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
  expect(replay.read().seconds).toBe(0);
  replay.stop(); replay.advance(10); expect(replay.read().frame).toBeNull();
});

it('蓄力で同じ時に合体した組も順番に選べる', () => {
  const lesson = createRuleSession('collapse', 21, true, true);
  lesson.advancePreparation();
  while (lesson.read().running) lesson.step();
  lesson.advancePreparation();
  const events = [];
  while (lesson.read().running) events.push(...lesson.step());
  const fusions = events.filter(e => e.kind === 'merge');
  expect(fusions.some((e, n) => n > 0 && e.tick === fusions[n - 1]!.tick)).toBe(true);
  const selected = [];
  for (let n = 0; n < fusions.length + 1; n++) {
    lesson.review.contact(); selected.push(lesson.review.read().focus?.sequence);
  }
  expect(selected.slice(1)).toEqual(fusions.map(e => e.sequence));
  expect(lesson.review.read().contactNumber).toBe(fusions.length + 1);
  lesson.review.contact(-1);
  expect(lesson.review.read().focus?.sequence).toBe(fusions.at(-2)?.sequence);
  expect(lesson.review.read().contactNumber).toBe(fusions.length);
  lesson.review.contact();
  lesson.review.contact();
  expect(lesson.review.read().contactNumber).toBe(1);
});

it('崩壊の発動から開くと、準備を飛ばして発動直前から見られる', () => {
  const lesson = createRuleSession('collapse', 21, true, true);
  for (let phase = 0; phase < 2; phase++) {
    lesson.advancePreparation();
    for (let n = 0; n < TICK_HZ; n++) lesson.step();
  }
  const before = lesson.read().curr.tick;
  expect(lesson.launch(dropAt(-Math.PI / 2))?.accepted).toBe(true);
  expect(lesson.collapse().accepted).toBe(true);
  for (let n = 0; n < 3 * TICK_HZ; n++) lesson.step();
  const final = lesson.read().curr;
  expect(lesson.review.read().hasCollapse).toBe(true);
  lesson.review.startFromCollapse();
  expect(lesson.review.read().frame?.curr.tick).toBe(before);
  expect(lesson.review.advance(4 * DT).filter(e => e.kind === 'collapse')).toHaveLength(1);
  expect(lesson.read().curr).toBe(final);
});

it('連投の見返しは、初回も再試行も同じ3投目の直前から始まる', () => {
  const first = createRuleSession('repeat');
  for (let shot = 0; shot < 2; shot++) {
    first.launch(dropAt(0));
    for (let n = 0; n < TICK_HZ; n++) first.step();
  }
  const repeat = first.repeatCheckpoint()!;
  const retry = createRuleSession('repeat', 21, false, false, { repeat });
  for (const [lesson, angle, added] of [[first, 0, 2], [retry, Math.PI, 0]] as const) {
    lesson.launch(dropAt(angle));
    for (let n = 0; n < TICK_HZ; n++) lesson.step();
    const final = lesson.read().curr;
    lesson.review.startFromTick(repeat.state.tick);
    expect(lesson.review.read().frame?.curr).toMatchObject({ tick: repeat.state.tick, heat: repeat.state.heat });
    const events = lesson.review.advance(4 * DT);
    expect(events.filter(e => e.kind === 'launch').map(e => e.heatDelta ?? 0)).toEqual([added]);
    expect(lesson.read().curr).toBe(final);
  }
});
