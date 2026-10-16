// 見どころ・負けた理由（出来事の索引から計算）と、
// プレイヤー（キーフレーム＋カーソルで盤面を再生）を突き合わせる。
// 2 つの独立した計算経路が、同じ場所を指しているかを確かめる。

import { describe, expect, it } from 'vitest';
import type { Tier } from '../contracts/game';
import { CORE_RADIUS, TICK_HZ } from '../game/constants';
import { at } from '../fixtures/index';
import type { SimulationSetup } from '../game/simulation';
import { analyzeCause } from './cause';
import { findHighlights } from './highlights';
import { createReplayPlayer } from './player';
import type { ReplayRecord } from './record';
import { recordSetup, UP } from './testkit';

/** 限界リングを越え続ける山（負ける記録を作る配置）。 */
const HOT_BODIES: SimulationSetup['bodies'] = [at(7, 130, 0), at(6, 280, 0), at(5, 400, 0)];

/**
 * 記録の見どころを 1 件ずつ取り、プレイヤーでその tick へ行って
 * 「その場所で本当にそれが起きている」かを確かめる。
 */
function checkHighlightsAgainstPlayer(record: ReplayRecord): void {
  const h = findHighlights(record);
  expect(h.ok).toBe(true);
  if (!h.ok) return;
  const start = createReplayPlayer(record);
  expect(start.ok).toBe(true);
  if (!start.ok) return;
  const p = start.player;
  for (const hl of h.highlights) {
    switch (hl.kind) {
      case 'supernova':
      case 'bestTier':
      case 'maxChain': {
        // 出来事が返った tick の 1 つ前からその tick まで進めると、
        // 区間 (tick-1, tick] の出来事＝その tick の出来事だけが events に並ぶ
        expect(hl.tick).toBeGreaterThan(0);
        p.seek(hl.tick - 1);
        p.seek(hl.tick);
        if (hl.kind === 'supernova') {
          expect(p.events.some((e) => e.kind === 'supernova'), `supernova@${hl.tick}`).toBe(true);
        } else if (hl.kind === 'bestTier') {
          expect(
            p.events.some((e) => e.kind === 'merge' && e.resultTier === hl.value),
            `bestTier@${hl.tick}`,
          ).toBe(true);
        } else {
          expect(p.events.some((e) => e.chain === hl.value), `maxChain@${hl.tick}`).toBe(true);
        }
        break;
      }
      case 'heatCritical': {
        // その tick の盤面で本当に 75 を越えていて、1 つ前では越えていない
        expect(p.seek(hl.tick).heat).toBe(hl.value);
        expect(hl.value).toBeGreaterThan(75);
        if (hl.tick > 0) expect(p.seek(hl.tick - 1).heat).toBeLessThanOrEqual(75);
        break;
      }
      case 'beforeGameOver': {
        // value（gameOver の tick）まで進めると、最後の出来事は gameOver
        p.seek(hl.tick);
        p.seek(hl.value);
        const kinds = p.events.map((e) => e.kind);
        expect(kinds.length).toBeGreaterThan(0);
        expect(kinds[kinds.length - 1]).toBe('gameOver');
        break;
      }
    }
  }
}

describe('見どころの tick は本当にその出来事の場所', () => {
  it('連鎖・最高 Tier・超新星・熱量・終了前の見どころが、実際の出来事・盤面と重なる', { timeout: 30_000 }, () => {
    // 連鎖 2 と最高 Tier 誕生がある記録
    const chain: SimulationSetup = {
      bodies: [
        at(0, CORE_RADIUS + 14, UP),
        at(0, CORE_RADIUS + 42, UP),
        at(1, CORE_RADIUS + 19, UP + 0.58),
      ],
    };
    checkHighlightsAgainstPlayer(recordSetup(1, chain, 3 * TICK_HZ));
    // 超新星 2 発
    const nova: SimulationSetup = {
      bodies: [at(8, 150, 0), at(8, 350, 0), at(8, 150, 2), at(8, 350, 2)],
      heat: 60,
      bestTier: 8 as Tier,
    };
    checkHighlightsAgainstPlayer(recordSetup(1, nova, 5));
    // 熱量の臨界越えとゲームオーバーまである記録
    const hot: SimulationSetup = { bodies: HOT_BODIES, heat: 50, bestTier: 8 as Tier };
    checkHighlightsAgainstPlayer(recordSetup(1, hot, 10 * TICK_HZ));
  });

  it('熱量の臨界越えは途中で起きても、最初の 1 回だけ立つ', { timeout: 30_000 }, () => {
    // 75 未満（50）から始めて、限界を越えた山が熱量を上げ続ける記録
    const hot: SimulationSetup = { bodies: HOT_BODIES, heat: 50, bestTier: 8 as Tier };
    const record = recordSetup(1, hot, 10 * TICK_HZ);
    expect(record.phase).toBe('over'); // 前提: 熱量は 100 まで上がり続ける
    const h = findHighlights(record);
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    const crits = h.highlights.filter((x) => x.kind === 'heatCritical');
    expect(crits).toHaveLength(1); // 越え続ける限り 2 回目は立たない
    // 開始時点ではまだ 75 以下なので、越えた瞬間は開始よりあと
    expect(crits[0]!.tick).toBeGreaterThan(0);
    expect(crits[0]!.value).toBeGreaterThan(75);
  });

  it('10 秒未満で終わった記録では、beforeGameOver は tick 0 に収まる', () => {
    const hot: SimulationSetup = { bodies: HOT_BODIES, heat: 96, bestTier: 8 as Tier };
    const record = recordSetup(1, hot, 10 * TICK_HZ);
    expect(record.phase).toBe('over');
    const h = findHighlights(record);
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    const soon = h.highlights.find((x) => x.kind === 'beforeGameOver');
    expect(soon).toBeDefined();
    // 前提: 熱量 96 始まりのこの記録は 10 秒（1200 tick）よりずっと早く終わる
    expect(soon!.value).toBeLessThan(10 * TICK_HZ);
    // 0 より前にはならないので、巻き戻しの入口は開始の盤面
    expect(soon!.tick).toBe(0);
  });
});

describe('負けた理由と盤面の突き合わせ', () => {
  it(
    '熱量が上がり始めた盤面はプレイヤーで同じ tick へ飛んだ物と一致し、犯人は本当に限界を越えている',
    { timeout: 30_000 },
    () => {
      const hot: SimulationSetup = { bodies: HOT_BODIES, heat: 96, bestTier: 8 as Tier };
      const record = recordSetup(1, hot, 10 * TICK_HZ);
      const c = analyzeCause(record);
      expect(c.ok && c.cause !== null).toBe(true);
      if (!c.ok || !c.cause) return;
      const start = createReplayPlayer(record);
      expect(start.ok).toBe(true);
      if (!start.ok) return;
      // cause が掴んだ盤面と、プレイヤーが同じ tick に再生した盤面が一致する
      const snap = start.player.seek(c.cause.heatRiseTick);
      expect(JSON.stringify(snap)).toBe(JSON.stringify(c.cause.snapshot));
      // 犯人の集合は、その盤面で本当に限界を越えている天体と一致する
      const ids = new Set(c.cause.culprits.map((b) => b.id));
      expect(ids.size).toBeGreaterThan(0);
      for (const b of snap.bodies) {
        if (b.overLimit) expect(ids.has(b.id)).toBe(true);
      }
    },
  );
});
