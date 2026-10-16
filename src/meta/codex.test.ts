import { describe, expect, it } from 'vitest';
import type { GameEvent, GameSnapshot, Tier } from '../contracts/game';
import { createAutoPlay, onCore, sampleEvent } from '../fixtures';
import {
  CODEX_ENTRIES,
  createCodexStore,
  evaluateCodex,
  type CodexContext,
  type CodexEntry,
} from './codex';
import type { MetaStorage } from './storage';

const STORAGE_KEY = 'gravity-core:codex:v1';

function memoryStorage(initial?: Record<string, string>): MetaStorage & { values: Map<string, string> } {
  const values = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

/** 最小の盤面。テストごとに必要な分だけ上書きする。 */
function snapshot(partial: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    tick: 1,
    phase: 'active',
    bodies: [],
    heat: 0,
    overLimit: false,
    score: 0,
    bestTierThisRun: 0,
    nextQueue: [0, 0, 0],
    launchCooldownLeftSeconds: 0,
    seed: 1,
    stats: { launches: 0, merges: 0, supernovas: 0, maxChain: 0 },
    ...partial,
  };
}

const META = { runIndex: 1, nowMs: 1_700_000_000_000 };

describe('図鑑の発見', () => {
  it('自動プレイの出来事を流し込むと、天体と出来事が見つかっていく', () => {
    const codex = createCodexStore(memoryStorage());
    // 同じ Tier が触れている盤面から始め、最初の合体を確実に起こす
    const auto = createAutoPlay(5, { bodies: [onCore(0, -1.9), onCore(0, -1.6)] });
    const events: GameEvent[] = [];
    for (let i = 0; i < 720; i++) {
      events.push(...auto.step());
      if (i % 60 === 0) codex.feed(events, auto.sim.getSnapshot(), META);
    }
    codex.feed(events, auto.sim.getSnapshot(), META);

    const found = new Set(codex.list().filter(v => v.found).map(v => v.id));
    expect(found.has('body-t0')).toBe(true); // 初期配置の天体
    expect(found.has('evt-launch')).toBe(true); // 自動で撃った
    expect(found.has('evt-merge')).toBe(true); // Tier 0 どうしが合体
    expect(found.has('body-t1')).toBe(true); // 合体で Tier 1 が生まれた
    expect(found.size).toBeGreaterThanOrEqual(4);
  });

  it('発見にはいつ・何回目のプレイの・何 tick 目かが残る', () => {
    const codex = createCodexStore(memoryStorage());
    codex.feed([{ ...sampleEvent('merge'), tick: 4321 }], snapshot({ tick: 5000 }), {
      runIndex: 7,
      nowMs: 123456,
      recordId: 'rec-abc',
    });
    // feed した時点の tick（5000）ではなく、出来事が起きた tick を残す（再生へ飛ぶため）
    expect(codex.discovery('evt-merge')).toEqual({
      id: 'evt-merge',
      foundAtMs: 123456,
      runIndex: 7,
      tick: 4321,
      recordId: 'rec-abc',
    });
  });

  it('盤面の天体は「生まれた tick」を、出来事の無い項目は「いまの tick」を残す', () => {
    const codex = createCodexStore(memoryStorage());
    const body = {
      id: 9, tier: 3 as Tier, x: 0, y: 100, vx: 0, vy: 0, radius: 32,
      bornTick: 777, chain: 0, chainUntilTick: 0, overLimit: false,
    };
    codex.feed([], snapshot({ tick: 9000, score: 20_000, bodies: [body] }), META);
    expect(codex.discovery('body-t3')!.tick).toBe(777); // 生まれた瞬間へ飛べる
    expect(codex.discovery('feat-score-10000')!.tick).toBe(9000); // 条件を満たした観測点
  });

  it('同じ項目は一度だけ返し、発見は保存をまたぐ', () => {
    const storage = memoryStorage();
    const codex = createCodexStore(storage);
    const events = [sampleEvent('supernova')];
    const first = codex.feed(events, snapshot(), META).map(e => e.id);
    expect(first).toContain('evt-supernova');
    expect(codex.feed(events, snapshot(), META)).toHaveLength(0); // 二度目は返さない

    const again = createCodexStore(storage);
    expect(again.isFound('evt-supernova')).toBe(true);
    expect(again.feed(events, snapshot(), META)).toHaveLength(0);
  });

  it('連鎖・得点・臨界など、盤面と出来事の両方で判定できる', () => {
    const codex = createCodexStore(memoryStorage());
    const events = [
      sampleEvent('merge', 2, 0, 0, 4), // chain 4
      sampleEvent('overLimitStart'),
      sampleEvent('overLimitEnd'),
    ];
    codex.feed(events, snapshot({ score: 60_000, heat: 80 }), META);
    const found = new Set(codex.list().filter(v => v.found).map(v => v.id));
    expect(found.has('feat-chain-2')).toBe(true);
    expect(found.has('feat-chain-4')).toBe(true);
    expect(found.has('feat-chain-5')).toBe(false);
    expect(found.has('evt-overlimit')).toBe(true);
    expect(found.has('evt-recover')).toBe(true);
    expect(found.has('feat-score-10000')).toBe(true);
    expect(found.has('feat-score-50000')).toBe(true);
    expect(found.has('feat-score-100000')).toBe(false);
    expect(found.has('feat-critical')).toBe(true);
  });

  it('未発見の項目は名前を隠して手がかりを出す', () => {
    const codex = createCodexStore(memoryStorage());
    const entry = CODEX_ENTRIES.find(e => e.id === 'evt-supernova')!;
    const view = codex.list().find(v => v.id === 'evt-supernova')!;
    expect(view.found).toBe(false);
    expect(view.name).toBe('？？？');
    expect(view.text).toBe(entry.hint); // 次に何を狙うかが分かる
    codex.feed([sampleEvent('supernova')], snapshot(), META);
    const after = codex.list().find(v => v.id === 'evt-supernova')!;
    expect(after.name).toBe('超新星');
    expect(after.text).toBe(entry.description);
  });

  it('進み具合を返す', () => {
    const codex = createCodexStore(memoryStorage());
    expect(codex.progress()).toEqual({ found: 0, total: CODEX_ENTRIES.length });
    codex.feed([sampleEvent('launch')], snapshot(), META);
    expect(codex.progress().found).toBeGreaterThanOrEqual(1);
  });

  it('項目は 15 個以上ある', () => {
    expect(CODEX_ENTRIES.length).toBeGreaterThanOrEqual(15);
    expect(new Set(CODEX_ENTRIES.map(e => e.id)).size).toBe(CODEX_ENTRIES.length);
  });
});

describe('図鑑の拡張（種類を足す）', () => {
  it('項目の表を差し替えるだけで動く。他のコードは変えない', () => {
    const custom: CodexEntry = {
      id: 'test-first-land',
      category: 'feat',
      name: 'テスト項目',
      description: 'd',
      hint: 'h',
      found: ctx => ctx.events.find(e => e.kind === 'land')?.tick ?? null,
    };
    const ctx: CodexContext = { events: [sampleEvent('land')], snapshot: snapshot() };
    // 表をそのまま評価する関数に渡すだけで判定できる
    expect(evaluateCodex(ctx, [custom]).map(e => e.id)).toEqual(['test-first-land']);
    // 既存の表に足しても、保存つきのストアがそのまま動く
    const codex = createCodexStore(memoryStorage(), [...CODEX_ENTRIES, custom]);
    const found = codex.feed(ctx.events, ctx.snapshot, META).map(e => e.id);
    expect(found).toContain('test-first-land');
  });
});

describe('壊れた保存', () => {
  it.each([
    '{oops',
    'null',
    '[1,2]',
    '{"version":9,"found":{}}',
    '{"version":1,"found":{"evt-merge":{"foundAtMs":"x","runIndex":1,"tick":0}}}',
    '{"version":1,"found":{"evt-merge":{"foundAtMs":1,"runIndex":0,"tick":0}}}',
    '{"version":1,"found":{"evt-merge":{"foundAtMs":1,"runIndex":1,"tick":-3}}}',
  ])('中身が %s でも落ちずに空から始まる', raw => {
    const codex = createCodexStore(memoryStorage({ [STORAGE_KEY]: raw }));
    expect(codex.progress().found).toBe(0);
    expect(() => codex.feed([sampleEvent('launch')], snapshot(), META)).not.toThrow();
  });

  it('未知の id の記録は残すが一覧には出さない', () => {
    const raw = JSON.stringify({
      version: 1,
      found: { 'future-entry': { foundAtMs: 1, runIndex: 1, tick: 0 } },
    });
    const storage = memoryStorage({ [STORAGE_KEY]: raw });
    const codex = createCodexStore(storage);
    expect(codex.isFound('future-entry')).toBe(true); // 将来の版で追加された項目を消さない
    expect(codex.list().some(v => v.id === 'future-entry')).toBe(false);
    expect(codex.progress().found).toBe(0); // 数えるのは今の表にある分だけ
  });

  it('保存の口が無くてもメモリで動く', () => {
    const codex = createCodexStore(null);
    expect(codex.feed([sampleEvent('launch')], snapshot(), META).length).toBeGreaterThan(0);
    expect(codex.isFound('evt-launch')).toBe(true);
  });
});

// Tier の網羅性: 9 種の天体項目があり、どれも正しい Tier で見つかる
describe('天体の項目', () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8] as const)('Tier %i が盤面に出ると見つかる', tier => {
    const events =
      tier === 0
        ? [sampleEvent('launch')] // sourceTier 0 で撃った
        : [sampleEvent('merge', (tier - 1) as Tier)]; // 合体で resultTier = tier が生まれた
    const ctx: CodexContext = { events, snapshot: snapshot() };
    const found = evaluateCodex(ctx, CODEX_ENTRIES.filter(e => e.id === `body-t${tier}`));
    expect(found.map(e => e.id)).toEqual([`body-t${tier}`]);
  });

  it('合体の材料になった Tier も「出た」と数える', () => {
    const ctx: CodexContext = {
      events: [sampleEvent('merge', 2)], // Tier 2 どうしが合体して Tier 3 に
      snapshot: snapshot(),
    };
    const found = new Set(evaluateCodex(ctx).map(e => e.id));
    expect(found.has('body-t2')).toBe(true);
    expect(found.has('body-t3')).toBe(true);
    expect(found.has('body-t4')).toBe(false);
  });
});
