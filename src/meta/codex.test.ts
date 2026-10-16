import { describe, expect, it } from 'vitest';
import type { BodyView, GameEvent, GameSnapshot, Tier } from '../contracts/game';
import { createAutoPlay, onCore, sampleEvent } from '../fixtures';
import {
  CODEX_ENTRIES,
  createCodexStore,
  evaluateCodex,
  type CodexContext,
  type CodexEntry,
} from './codex';
import { JST_OFFSET_MS } from './daily';
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

/** 見た目だけの天体。数を並べるテスト用。 */
function body(id: number, tier: Tier = 0, bornTick = 0): BodyView {
  return {
    id, tier, x: id, y: id, vx: 0, vy: 0, radius: 10,
    bornTick, chain: 0, chainUntilTick: 0, overLimit: false,
  };
}

/** 盤面だけを変えて判定する（純粋関数 evaluateCodex に流す）。 */
const foundIds = (partial: Partial<GameSnapshot>, events: GameEvent[] = [], nowMs?: number): string[] =>
  evaluateCodex({ events, snapshot: snapshot(partial), nowMs }).map(e => e.id);

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
    const totalOf = (cat: 'body' | 'event' | 'feat') =>
      CODEX_ENTRIES.filter(e => e.category === cat).length;
    expect(codex.progress()).toEqual({
      found: 0,
      total: CODEX_ENTRIES.length,
      categories: {
        body: { found: 0, total: totalOf('body') },
        event: { found: 0, total: totalOf('event') },
        feat: { found: 0, total: totalOf('feat') },
      },
    });
    codex.feed([sampleEvent('launch')], snapshot(), META);
    expect(codex.progress().found).toBeGreaterThanOrEqual(1);
  });

  it('項目は 15 個以上ある', () => {
    expect(CODEX_ENTRIES.length).toBeGreaterThanOrEqual(15);
    expect(new Set(CODEX_ENTRIES.map(e => e.id)).size).toBe(CODEX_ENTRIES.length);
  });

  it('id は素朴な文字列だけでできている（オブジェクト展開の壊れを防ぐ）', () => {
    // 表の生成で `${obj}` のようにオブジェクトを埋めると '[object Object]' に化けて
    // id が重複する。文字種を固定するとその類の壊れがすぐ見える
    for (const e of CODEX_ENTRIES) expect(e.id).toMatch(/^[a-z0-9-]+$/);
  });

  it('全部の項目に名前・説明・手がかりがあり、一覧は表の順で出る', () => {
    for (const e of CODEX_ENTRIES) {
      expect(e.id).not.toBe('');
      expect(e.name).not.toBe('');
      expect(e.description).not.toBe('');
      // 未発見の人が「次に何を狙うか」読めるよう、手がかりは必須
      expect(e.hint).not.toBe('');
      expect(['body', 'event', 'feat']).toContain(e.category);
    }
    const codex = createCodexStore(memoryStorage());
    expect(codex.list().map(v => v.id)).toEqual(CODEX_ENTRIES.map(e => e.id));
  });
});

describe('盤面だけで判定する項目', () => {
  it('同時に並ぶ天体の数で満員御礼・大混雑が見つかる', () => {
    const bodies = (n: number) => ({ bodies: Array.from({ length: n }, (_, i) => body(i)) });
    expect(foundIds(bodies(19))).not.toContain('feat-crowd');
    expect(foundIds(bodies(20))).toContain('feat-crowd');
    expect(foundIds(bodies(20))).not.toContain('feat-overflow');
    expect(foundIds(bodies(30))).toContain('feat-overflow');
  });

  it('プレイの統計で量産体制・百発運用・超新星三昧が見つかる', () => {
    const stats = (launches: number, merges: number, supernovas: number) => ({
      stats: { launches, merges, supernovas, maxChain: 0 },
    });
    expect(foundIds(stats(100, 25, 3))).toEqual(
      expect.arrayContaining(['feat-merges', 'feat-launches', 'feat-triple-nova']),
    );
    const under = foundIds(stats(99, 24, 2));
    expect(under).not.toContain('feat-merges');
    expect(under).not.toContain('feat-launches');
    expect(under).not.toContain('feat-triple-nova');
  });

  it('生存時間・合体なしの我慢・限界寸前を判定する', () => {
    // 時間系の項目は「遊んだ」証拠（1 射以上）が要るので、発射済みの統計で判定する
    const played = { launches: 10, merges: 0, supernovas: 0, maxChain: 0 };
    expect(foundIds({ tick: 3 * 60 * 120, stats: played })).toContain('feat-survive');
    expect(foundIds({ tick: 3 * 60 * 120 - 1, stats: played })).not.toContain('feat-survive');
    expect(foundIds({ tick: 60 * 120, stats: played })).toContain('feat-quiet');
    // 1 度でも合体していれば沈黙ではない
    expect(foundIds({ tick: 60 * 120, stats: { ...played, merges: 1 } })).not.toContain('feat-quiet');
    expect(foundIds({ tick: 60 * 120 - 1, stats: played })).not.toContain('feat-quiet');
    expect(foundIds({ heat: 90, phase: 'active' })).toContain('feat-brink');
    // 終わった盤面は九死ではない
    expect(foundIds({ heat: 90, phase: 'over' })).not.toContain('feat-brink');
    expect(foundIds({ heat: 89, phase: 'active' })).not.toContain('feat-brink');
  });

  it('1 射もしない放置ランでは、時間系の項目を取れない', () => {
    // 撃たずに放置しても tick だけは進むので、こういう盤面は実際にありうる
    const idle = { launches: 0, merges: 0, supernovas: 0, maxChain: 0 };
    const ids = foundIds({ tick: 40_000, stats: idle });
    expect(ids).not.toContain('feat-survive');
    expect(ids).not.toContain('feat-quiet');
    // 1 射でもしていれば、同じ経過時間で取れる
    const played = { ...idle, launches: 1 };
    expect(foundIds({ tick: 40_000, stats: played })).toContain('feat-survive');
    expect(foundIds({ tick: 40_000, stats: played })).toContain('feat-quiet');
  });

  it('到達済み Tier より下の天体は、証拠が無くても出たとみなす', () => {
    const ids = foundIds({ bestTierThisRun: 5 });
    expect(ids).toContain('body-t5');
    expect(ids).toContain('body-t4');
    expect(ids).not.toContain('body-t6');
  });
});

describe('出来事だけで判定する項目', () => {
  it('連鎖の中の超新星・終了・超新星は Tier 8 の証拠にもなる', () => {
    expect(foundIds({}, [sampleEvent('supernova', 8, 0, 0, 2)])).toContain('feat-nova-chain');
    expect(foundIds({}, [sampleEvent('supernova', 8, 0, 0, 1)])).not.toContain('feat-nova-chain');
    expect(foundIds({}, [sampleEvent('supernova')])).toContain('body-t8');
    expect(foundIds({}, [sampleEvent('gameOver')])).toContain('evt-gameover');
  });
});

// 出来事の列を取りこぼしても（feed が途中からでも）、盤面・統計に残る証拠で見つける
describe('盤面側の証拠による発見', () => {
  it('発射・合体・超新星は統計が証拠になる', () => {
    const ids = foundIds({ stats: { launches: 2, merges: 1, supernovas: 1, maxChain: 0 } });
    expect(ids).toContain('evt-launch');
    expect(ids).toContain('evt-merge');
    expect(ids).toContain('evt-supernova');
  });

  it('終了した盤面・限界の旗もそれぞれの証拠になる', () => {
    expect(foundIds({ phase: 'over' })).toContain('evt-gameover');
    expect(foundIds({ overLimit: true })).toContain('evt-overlimit');
  });

  it('連鎖は統計の最大連鎖が証拠になるが、連鎖した超新星は取れない', () => {
    const ids = foundIds({ stats: { launches: 5, merges: 8, supernovas: 0, maxChain: 5 } });
    expect(ids).toContain('feat-chain-5');
    // 「超新星が連鎖した」証拠は盤面に残らないので、出来事限定のままにしている
    expect(ids).not.toContain('feat-nova-chain');
  });

  it('着地は盤面から分からないので、出来事が無ければ見つからない', () => {
    // 撃って積もった跡は統計にあるが、「触れた」事実そのものは統計に残らない
    const ids = foundIds({ stats: { launches: 5, merges: 2, supernovas: 0, maxChain: 1 } });
    expect(ids).not.toContain('evt-land');
  });

  it('出来事があればその tick を優先し、統計だけなら観測 tick を残す', () => {
    const codex = createCodexStore(memoryStorage());
    const stats = { launches: 1, merges: 3, supernovas: 0, maxChain: 1 };
    codex.feed([{ ...sampleEvent('merge'), tick: 123 }], snapshot({ tick: 999, stats }), META);
    expect(codex.discovery('evt-merge')!.tick).toBe(123); // 出来事の瞬間
    expect(codex.discovery('evt-launch')!.tick).toBe(999); // 統計だけ → 観測点
  });
});

describe('限界越えの時間と回数で判定する項目', () => {
  const start = (tick: number): GameEvent => ({ ...sampleEvent('overLimitStart'), tick });
  const end = (tick: number): GameEvent => ({ ...sampleEvent('overLimitEnd'), tick });
  const LIMIT = 10 * 120;

  it('越えた時間が合計 10 秒になると見つかる（分かれても合計でよい）', () => {
    expect(foundIds({}, [start(100), end(100 + LIMIT)])).toContain('feat-tightrope');
    const split = [start(0), end(6 * 120), start(1000), end(1000 + 6 * 120)];
    expect(foundIds({}, split)).toContain('feat-tightrope');
    expect(foundIds({}, [start(0), end(LIMIT - 1)])).not.toContain('feat-tightrope');
  });

  it('越えたまま終わっていないときは盤面の時計までを足し、足りなければ見つからない', () => {
    expect(foundIds({ tick: 100 + LIMIT, overLimit: true }, [start(100)])).toContain(
      'feat-tightrope',
    );
    expect(foundIds({ tick: 100 + LIMIT - 1, overLimit: true }, [start(100)])).not.toContain(
      'feat-tightrope',
    );
    // 旗が降りているのに End だけ無い組は、証拠不足にする
    expect(foundIds({ tick: 100 + LIMIT, overLimit: false }, [start(100)])).not.toContain(
      'feat-tightrope',
    );
  });

  it('発見 tick は合計が越えた瞬間を指す', () => {
    const codex = createCodexStore(memoryStorage());
    codex.feed([start(100)], snapshot({ tick: 100 + LIMIT + 50, overLimit: true }), META);
    expect(codex.discovery('feat-tightrope')!.tick).toBe(100 + LIMIT);
  });

  it('3 度目の立て直しで見つかり、その瞬間の tick を指す', () => {
    const twice = [start(0), end(10), start(20), end(30)];
    expect(foundIds({}, twice)).not.toContain('feat-recover-3');
    const thrice = [...twice, start(40), end(50)];
    expect(foundIds({}, thrice)).toContain('feat-recover-3');
    const codex = createCodexStore(memoryStorage());
    codex.feed(thrice, snapshot({ tick: 9999 }), META);
    expect(codex.discovery('feat-recover-3')!.tick).toBe(50);
  });
});

describe('観測時刻で判定する項目', () => {
  /** JST のその日の hour 時に相当する UTC ms。 */
  const jstMs = (hour: number) => Date.UTC(2026, 9, 16, hour) - JST_OFFSET_MS;

  const played = { launches: 3, merges: 0, supernovas: 0, maxChain: 0 };

  it('日本時間の深夜（0 時〜5 時前）だけ見つかる。時刻が無ければ判定しない', () => {
    const at = (h?: number) => foundIds({ stats: played }, [], h);
    expect(at(jstMs(3))).toContain('feat-night-owl');
    expect(at(jstMs(5))).not.toContain('feat-night-owl');
    expect(at(jstMs(12))).not.toContain('feat-night-owl');
    expect(at(undefined)).not.toContain('feat-night-owl');
  });

  it('深夜でも、1 射もしない放置では見つからない', () => {
    const idle = { launches: 0, merges: 0, supernovas: 0, maxChain: 0 };
    expect(foundIds({ stats: idle }, [], jstMs(3))).not.toContain('feat-night-owl');
    expect(foundIds({ stats: { ...idle, launches: 1 } }, [], jstMs(3))).toContain(
      'feat-night-owl',
    );
  });
});

describe('記録と保存の細部', () => {
  it('回数や時刻が変でも、記録は 1 番・時刻 0 で残る', () => {
    const codex = createCodexStore(memoryStorage());
    codex.feed([sampleEvent('launch')], snapshot(), { runIndex: 0, nowMs: Number.NaN });
    expect(codex.discovery('evt-launch')).toMatchObject({ runIndex: 1, foundAtMs: 0 });
  });

  it('新しい発見が無ければ保存を書き換えない', () => {
    const storage = memoryStorage();
    const codex = createCodexStore(storage);
    codex.feed([sampleEvent('launch')], snapshot(), META);
    const saved = storage.values.get(STORAGE_KEY);
    expect(saved).toBeTruthy();
    codex.feed([sampleEvent('land')], snapshot(), META); // evt-land は新規 → 書き込み発生
    const afterLand = storage.values.get(STORAGE_KEY);
    expect(afterLand).not.toBe(saved);
    codex.feed([sampleEvent('land')], snapshot(), META); // 新規なし → そのまま
    expect(storage.values.get(STORAGE_KEY)).toBe(afterLand);
  });
});

describe('速さ', () => {
  it('自動プレイの終盤でも feed 1 回は重くならない', () => {
    const codex = createCodexStore(memoryStorage());
    const auto = createAutoPlay(7, { bodies: [onCore(0, -1.9), onCore(0, -1.6)] });
    const events: GameEvent[] = [];
    let worst = 0;
    for (let i = 0; i < 720; i++) {
      events.push(...auto.step());
      if (i % 30 !== 0) continue;
      const t0 = performance.now();
      codex.feed(events, auto.sim.getSnapshot(), META);
      worst = Math.max(worst, performance.now() - t0);
    }
    // 出来事が積み上がった終盤の 1 回でも 50ms 以内（実測は 1ms 前後）
    expect(worst).toBeLessThan(50);
  });
});

// 未発見の人が読む手がかりの品質を固定する
describe('手がかり（hint）', () => {
  it('全部ちがう文で、隠した名前を明かさず、1 行で読める', () => {
    const hints = CODEX_ENTRIES.map(e => e.hint);
    // 同じ手がかりが 2 つあると、未発見の項目どうしを見分けられない
    expect(new Set(hints).size).toBe(hints.length);
    for (const e of CODEX_ENTRIES) {
      expect(e.hint).not.toContain('？'); // 隠し名の表記を手がかり側で使わない
      expect(e.hint).not.toBe(e.name); // 手がかりが答えを明かさない
      expect(e.hint.length).toBeLessThanOrEqual(60); // 一覧の 1 行に収まる長さ
    }
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

// 「静かな 1 分」は終盤にまとめて feed されても、出来事の列から遡って見つかる
describe('静かな 1 分の検出', () => {
  const merged = (tick: number): GameEvent => ({ ...sampleEvent('merge'), tick });
  const stats = { launches: 10, merges: 1, supernovas: 0, maxChain: 1 };

  it('静かな 1 分のあとに合体しても、最初の合体の時刻から達成と分かる', () => {
    expect(foundIds({ tick: 20_000, stats }, [merged(60 * 120 + 300)])).toContain('feat-quiet');
    // ちょうど 1 分の瞬間の合体も「その 1 分は静かだった」とみなす
    expect(foundIds({ tick: 20_000, stats }, [merged(60 * 120)])).toContain('feat-quiet');
  });

  it('1 分より前の合体なら静かではない', () => {
    expect(foundIds({ tick: 20_000, stats }, [merged(60 * 120 - 1)])).not.toContain('feat-quiet');
  });

  it('合体の出来事が無いのに統計だけ増えている場合は、証拠不足で見つからない', () => {
    const onlyStats = { launches: 10, merges: 2, supernovas: 0, maxChain: 1 };
    expect(foundIds({ tick: 20_000, stats: onlyStats })).not.toContain('feat-quiet');
  });

  it('発見 tick は条件を満たした瞬間そのものを指す', () => {
    const codex = createCodexStore(memoryStorage());
    // 発射はしたが合体なしで 3 分強が経った盤面をまとめて feed する
    codex.feed(
      [],
      snapshot({
        tick: 3 * 60 * 120 + 999,
        stats: { launches: 4, merges: 0, supernovas: 0, maxChain: 0 },
      }),
      META,
    );
    // 静かな 1 分は 1 分の瞬間、生存は 3 分の瞬間へ飛べる（feed した時点ではない）
    expect(codex.discovery('feat-quiet')!.tick).toBe(60 * 120);
    expect(codex.discovery('feat-survive')!.tick).toBe(3 * 60 * 120);
  });
});

describe('feed の返り値', () => {
  it('一度に複数見つかるとき、表の順で返す', () => {
    const codex = createCodexStore(memoryStorage());
    const found = codex
      .feed([sampleEvent('merge', 0, 0, 0, 5)], snapshot({ score: 200_000, heat: 95 }), META)
      .map(e => e.id);
    expect(found.length).toBeGreaterThanOrEqual(3);
    const order = CODEX_ENTRIES.map(e => e.id);
    expect(found).toEqual([...found].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
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

// 一覧画面が「天体 3/9」のようにカテゴリごとに出せる形にする
describe('カテゴリ別の進み具合', () => {
  it('発見すると該当カテゴリだけが増え、合計は全体と一致する', () => {
    const codex = createCodexStore(memoryStorage());
    codex.feed([sampleEvent('merge')], snapshot(), META); // evt-merge が見つかる
    const p = codex.progress();
    expect(p.categories.event.found).toBeGreaterThanOrEqual(1);
    const sum = p.categories.body.found + p.categories.event.found + p.categories.feat.found;
    expect(sum).toBe(p.found);
    const total =
      p.categories.body.total + p.categories.event.total + p.categories.feat.total;
    expect(total).toBe(p.total);
  });

  it('項目の無いカテゴリは 0/0 で返す（表示側が分岐しないで済む）', () => {
    const only: CodexEntry = {
      id: 'x-only',
      category: 'feat',
      name: 'n',
      description: 'd',
      hint: 'h',
      found: () => null,
    };
    const codex = createCodexStore(memoryStorage(), [only]);
    const p = codex.progress();
    expect(p.categories.body).toEqual({ found: 0, total: 0 });
    expect(p.categories.event).toEqual({ found: 0, total: 0 });
    expect(p.categories.feat).toEqual({ found: 0, total: 1 });
  });
});

// 「最近の発見」欄・NEW バッジ用に、新しい順で取り出せる
describe('最近の発見（latest）', () => {
  it('新しく見つけた順に返し、個数を絞れる', () => {
    const codex = createCodexStore(memoryStorage());
    codex.feed([sampleEvent('launch')], snapshot(), { runIndex: 1, nowMs: 100 });
    codex.feed([sampleEvent('merge')], snapshot(), { runIndex: 2, nowMs: 200 });
    const all = codex.latest(20);
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.every(v => v.found)).toBe(true);
    const order = all.map(v => v.id);
    // evt-merge（nowMs 200 の発見）が evt-launch（100）より先に来る
    expect(order.indexOf('evt-merge')).toBeLessThan(order.indexOf('evt-launch'));
    expect(codex.latest(1).map(v => v.id)).toEqual([order[0]]);
  });

  it('同じ時刻に見つかった項目は表の順を保つ', () => {
    const codex = createCodexStore(memoryStorage());
    codex.feed([sampleEvent('merge', 0, 0, 0, 5)], snapshot({ score: 200_000, heat: 95 }), META);
    const ids = codex.latest(50).map(v => v.id);
    const tableOrder = CODEX_ENTRIES.map(e => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => tableOrder.indexOf(a) - tableOrder.indexOf(b)));
  });

  it('個数の上限は 0 以上の整数に丸める', () => {
    const codex = createCodexStore(memoryStorage());
    codex.feed([sampleEvent('launch')], snapshot(), META);
    expect(codex.latest(0)).toHaveLength(0);
    expect(codex.latest(-3)).toHaveLength(0);
    expect(codex.latest(0.9)).toHaveLength(0); // 小数は切り捨て
    expect(codex.latest(Number.NaN)).toHaveLength(0);
    expect(codex.latest(1.9)).toHaveLength(1);
  });

  it('保存をまたいでも発見時刻の順に並び、表に無い記録は出さない', () => {
    const storage = memoryStorage();
    createCodexStore(storage).feed([sampleEvent('launch')], snapshot(), {
      runIndex: 1,
      nowMs: 50,
    });
    const codex = createCodexStore(storage);
    codex.feed([sampleEvent('merge')], snapshot(), { runIndex: 2, nowMs: 999 });
    const ids = codex.latest(20).map(v => v.id);
    expect(ids.indexOf('evt-merge')).toBeLessThan(ids.indexOf('evt-launch'));

    const ghosted = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({
        version: 1,
        found: { 'ghost-entry': { foundAtMs: 1e15, runIndex: 1, tick: 0 } },
      }),
    });
    const codex2 = createCodexStore(ghosted);
    expect(codex2.latest(20).some(v => v.id === 'ghost-entry')).toBe(false);
  });
});

// 着地の速さは impactSpeed（出来事にだけ残る）で判定する 2 項目
describe('着地の速さで判定する項目', () => {
  const land = (tick: number, impactSpeed: number): GameEvent => ({
    ...sampleEvent('land'),
    tick,
    impactSpeed,
  });

  it('ゆっくり触れた着地で「そっと着地」が見つかり、その瞬間の tick を指す', () => {
    expect(foundIds({}, [land(10, 120)])).toContain('feat-soft-land');
    expect(foundIds({}, [land(10, 150)])).toContain('feat-soft-land'); // 境目は含む
    expect(foundIds({}, [land(10, 151)])).not.toContain('feat-soft-land');
    const codex = createCodexStore(memoryStorage());
    codex.feed([land(77, 100)], snapshot({ tick: 9000 }), META);
    expect(codex.discovery('feat-soft-land')!.tick).toBe(77);
  });

  it('速いままぶつかった着地で「剛速球」が見つかる', () => {
    expect(foundIds({}, [land(10, 600)])).toContain('feat-hard-land'); // 境目は含む
    expect(foundIds({}, [land(10, 700)])).toContain('feat-hard-land');
    expect(foundIds({}, [land(10, 599)])).not.toContain('feat-hard-land');
  });

  it('着地の速さは盤面に残らないので、出来事が無ければ見つからない', () => {
    const ids = foundIds({
      stats: { launches: 9, merges: 2, supernovas: 0, maxChain: 1 },
      bodies: [body(1)],
    });
    expect(ids).not.toContain('feat-soft-land');
    expect(ids).not.toContain('feat-hard-land');
  });
});
