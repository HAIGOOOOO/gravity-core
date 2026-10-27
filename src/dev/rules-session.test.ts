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
    expect(result.curr.heat).toBeLessThan(lesson.before.heat);
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
  it('初回の崩壊は射出後に停止して操作を待ち、押したら本物の計算を再開する', () => {
    const lesson = createRuleSession('collapse', 21, true); lesson.launch(dropAt(0));
    const tick = lesson.read().curr.tick;
    for (let n = 0; n < 300; n++) lesson.step();
    expect(lesson.read().curr.tick).toBe(tick); expect(lesson.read().armed).toBe(true);
    expect(lesson.read().curr.intervention?.ready).toBe(true);
    expect(lesson.collapse().accepted).toBe(true);
    for (let n = 0; n < 300; n++) lesson.step();
    expect(lesson.read().finished).toBe('collapse'); expect(lesson.read().interventionCooling).toBeGreaterThan(0);
  });
  it('崩壊の準備は解放前から同じ盤面で合体を進め、満タンにしてから一投する', () => {
    const lesson = createRuleSession('collapse', 21, true, true);
    expect(lesson.before.intervention).toMatchObject({ unlocked: false, charge: 0 });
    expect(lesson.launch(dropAt(0))).toBeNull();
    lesson.advancePreparation();
    for (let n = 0; n < TICK_HZ; n++) lesson.step();
    expect(lesson.read().preparation).toBe('charge');
    expect(lesson.read().curr.intervention).toMatchObject({ unlocked: true, charge: 1 });
    const unlockedTick = lesson.read().curr.tick;
    lesson.advancePreparation();
    for (let n = 0; n < 5 * TICK_HZ; n++) lesson.step();
    expect(lesson.read().preparation).toBe('ready');
    expect(lesson.read().curr.tick).toBeGreaterThan(unlockedTick);
    expect(lesson.read().curr.intervention?.charge).toBe(BURST_MAX);
    expect(lesson.read().curr.heat).toBeGreaterThan(0);
    expect(lesson.launch(dropAt(-Math.PI / 2))?.accepted).toBe(true);
    expect(lesson.read().armed).toBe(true);
    expect(lesson.collapse().accepted).toBe(true);
    for (let n = 0; n < 3 * TICK_HZ; n++) lesson.step();
    expect(lesson.read().finished).toBe('collapse');
    expect(lesson.read().interventionCooling).toBeGreaterThan(0);
  });
  it('敗因の見本も実際の限界上昇と射出加熱で終了し、原因を取り違えない', () => {
    const pile = createRuleSession('loss'); pile.startLoss();
    for (let n = 0; n < 300; n++) pile.step();
    expect(pile.read().finished).toBe('over'); expect(pile.read().curr.loss?.kind).toBe('overLimit');
    const repeat = createRuleSession('loss-repeat');
    expect(repeat.predict(dropAt(0)).launchHeat).toBe(1);
    repeat.launch(dropAt(0)); repeat.step();
    expect(repeat.read().finished).toBe('over'); expect(repeat.read().curr.loss).toMatchObject({ kind: 'repeatLaunch', heatAdded: 1 });
  });
  it('連投は本人の最初の2投を加熱せず、3投目で実加熱し、待機中は進まない', () => {
    const lesson = createRuleSession('repeat');
    expect(lesson.before.recentLaunches).toHaveLength(0);
    for (let shot = 0; shot < 3; shot++) {
      const tick = lesson.read().curr.tick;
      lesson.step(); expect(lesson.read().curr.tick).toBe(tick);
      expect(lesson.predict(dropAt(0)).launchHeat).toBe(shot === 2 ? 2 : 0);
      expect(lesson.launch(dropAt(0))?.accepted).toBe(true);
      expect(lesson.launch(dropAt(0))).toBeNull();
      for (let n = 0; n < TICK_HZ; n++) lesson.step();
    }
    const result = lesson.read();
    expect(result.finished).toBe('repeat'); expect(result.shots.map(s => s.heat)).toEqual([0, 0, 2]);
    expect(result.curr.heat).toBeCloseTo(lesson.before.heat + result.shotHeating - result.mergeCooling + result.passiveChange);
  });
  it('連投の3投目は、反対側を自分で選ぶと加熱を避けられる', () => {
    const lesson = createRuleSession('repeat');
    for (let shot = 0; shot < 2; shot++) {
      lesson.launch(dropAt(0));
      for (let n = 0; n < TICK_HZ; n++) lesson.step();
    }
    expect(lesson.predict(dropAt(Math.PI)).launchHeat).toBe(0);
    lesson.launch(dropAt(Math.PI)); lesson.step();
    expect(lesson.read().finished).toBe('repeat'); expect(lesson.read().shotHeating).toBe(0);
    expect(lesson.read().shots.map(s => s.heat)).toEqual([0, 0, 0]);
  });
});
