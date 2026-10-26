import { describe, expect, it } from 'vitest';
import { createRuleSession } from './rules-session';
import { GROWTH_PREVIEW_COMMAND } from '../fixtures/growth-preview';
import { dropAt } from '../fixtures';
import { BURST_MAX, COLLAPSE_COOL_PER_SECOND, COLLAPSE_SECONDS, TICK_HZ, TIER_RADIUS } from '../game/constants';

describe('ルールの練習も同じ計算を使う', () => {
  it('説明中は進まず、一投の2連鎖で最大成長後に止め、内訳を実熱量へ一致させる', () => {
    const lesson = createRuleSession('learn');
    for (let i = 0; i < 2 * TICK_HZ; i++) lesson.step();
    expect(lesson.read().curr).toEqual(lesson.before);
    lesson.launch(dropAt(-Math.PI / 2));
    for (let i = 0; i < 3 * TICK_HZ; i++) lesson.step();
    const result = lesson.read(), body = result.curr.bodies.find((b) => b.id === result.resultBodyId)!;
    expect(result.finished).toBe('chain'); expect(result.mergeCooling).toBe(7);
    expect(result.score).toBe(430); expect(body.radius).toBe(TIER_RADIUS[body.tier]);
    expect(result.passiveChange).toBeGreaterThan(0);
    expect(result.lastFusion!.before - result.lastFusion!.after).toBeCloseTo(5);
    expect(result.curr.heat).toBeCloseTo(lesson.before.heat - result.mergeCooling + result.passiveChange);
    const tick = result.curr.tick; lesson.step(); expect(lesson.read().curr.tick).toBe(tick);
  });
  it('成長の予告・元の配置・実結果を残し、放置しても自然冷却で0にしない', () => {
    const lesson = createRuleSession('growth');
    expect(lesson.prediction?.mergePreview?.mayCrossLimit).toBe(true);
    lesson.launch(GROWTH_PREVIEW_COMMAND);
    for (let i = 0; i < 10 * TICK_HZ; i++) lesson.step();
    const result = lesson.read(); expect(result.finished).toBe('growth');
    expect(result.merges).toBe(1); expect(result.curr.heat).toBeGreaterThan(60);
    expect(result.curr.bodies.find((b) => b.id === result.resultBodyId)?.radius).toBe(TIER_RADIUS[5]);
    expect(lesson.before.bodies).toHaveLength(3);
  });
  it('崩壊の準備を自分の得点へ加えず、実際の冷却を分けて終了する', () => {
    const lesson = createRuleSession('collapse');
    expect(lesson.read().score).toBe(0); expect(lesson.read().merges).toBe(0);
    expect(lesson.read().curr.intervention?.charge).toBe(BURST_MAX);
    lesson.launch(dropAt(-Math.PI / 2)); expect(lesson.collapse().accepted).toBe(true);
    for (let i = 0; i < 3 * TICK_HZ; i++) lesson.step();
    const r = lesson.read(); expect(r.finished).toBe('collapse'); expect(r.interventionCooling).toBeGreaterThan(0);
    expect(r.curr.heat).toBeGreaterThan(0);
    expect(r.interventionCooling).toBeLessThanOrEqual(COLLAPSE_COOL_PER_SECOND * COLLAPSE_SECONDS);
    expect(r.curr.heat).toBeCloseTo(lesson.before.heat - r.mergeCooling - r.interventionCooling + r.passiveChange);
  });
  it('崩壊の時間切れでも終わり、拒否された射出では再開しない', () => {
    const lesson = createRuleSession('collapse'); lesson.launch(dropAt(0));
    for (let i = 0; i < 3 * TICK_HZ; i++) lesson.step();
    expect(lesson.read().finished).toBe('expired'); expect(lesson.collapse().accepted).toBe(false);
    expect(lesson.read().curr.heat).toBeGreaterThan(70);
    expect(lesson.launch(dropAt(1))).toBeNull();
  });
});
