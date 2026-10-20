import { describe, expect, it } from 'vitest';
import type { GameEvent, GameEventKind, GameSnapshot } from '../contracts/game';
import { TICK_HZ, TIER_COUNT } from '../game/constants';
import { createAutoPlay, onCore } from '../fixtures';
import { buildRunDetail } from './stats';
import { readRunDetail } from './archive';

const META = { id: 'run-1', playedAt: '2026-10-16T00:00:00.000Z', gameVersion: '0.1.0' } as const;

let sequence = 0;
function event(kind: GameEventKind, tick: number, extra: Partial<GameEvent> = {}): GameEvent {
  return { sequence: sequence++, tick, kind, ...extra };
}
function snapshot(partial: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    tick: 0,
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
const asTier = (value: number) => value as unknown as GameSnapshot['bestTierThisRun'];

describe('プレイ統計の作成', () => {
  it('出来事の列から各項目を数え、限界超過は区間の和を取る', () => {
    const events = [
      event('launch', 1),
      event('land', 30, { impactSpeed: 500 }),
      event('launch', 40),
      event('land', 60, { impactSpeed: 700 }),
      event('merge', 61, { sourceTier: 0, resultTier: 1, chain: 1, scoreDelta: 100 }),
      event('merge', 62, { sourceTier: 1, resultTier: 2, chain: 2, scoreDelta: 330 }),
      event('supernova', 70, { sourceTier: 8, chain: 5, scoreDelta: 99999 }),
      event('overLimitStart', 100),
      event('overLimitEnd', 220),
      event('overLimitStart', 300),
      event('gameOver', 400),
    ];
    // 盤面の得点は出来事の記録の合計（100 + 330 + 99999 = 100429）を上回る → 盤面側を採る
    const snap = snapshot({
      tick: 400, phase: 'over', score: 200000, bestTierThisRun: 5, seed: 42,
      stats: { launches: 2, merges: 2, supernovas: 1, maxChain: 5 },
    });
    const d = buildRunDetail(events, snap, META);
    expect(d.id).toBe('run-1');
    expect(d.seed).toBe(42);
    expect(d.score).toBe(200000);
    expect(d.seconds).toBeCloseTo(400 / TICK_HZ, 10);
    expect(d.launches).toBe(2);
    expect(d.lands).toBe(2);
    expect(d.merges).toBe(2);
    expect(d.supernovas).toBe(1);
    expect(d.maxChain).toBe(5);
    // 超新星の記録がある以上 Tier 8 には届いている。盤面の到達 Tier が下を向いていても
    // （欠損・別版の盤面など）実績の大きい方を採る。merges 等の counted() と同じ考え方
    expect(d.bestTier).toBe(TIER_COUNT - 1);
    // 越えていたのは tick 100〜220 と 300〜400（終了まで開きっぱなし）
    expect(d.overLimitSeconds).toBeCloseTo(220 / TICK_HZ, 10);
    expect(d.overLimitEntries).toBe(2);
    expect(d.scorePerLaunch).toBeCloseTo(100000, 10);
    expect(d.maxSingleScore).toBe(99999);
    expect(d.maxImpactSpeed).toBe(700);
    expect(d.mergesByTier).toHaveLength(TIER_COUNT);
    expect(d.mergesByTier[0]).toBe(1);
    expect(d.mergesByTier[1]).toBe(1);
    // 超新星は合体回数に含めない
    expect(d.mergesByTier[8]).toBe(0);
    expect(d.mergesByTier.reduce((a, b) => a + b, 0)).toBe(2);
    // 作った統計はそのまま検査を通る（次回の読み込みで捨てられない）
    expect(readRunDetail(d)).not.toBeNull();
  });
  it('出来事に連鎖が無いときは盤面の集計を使う', () => {
    const events = [event('merge', 5, { sourceTier: 0, resultTier: 1, scoreDelta: 100 })];
    const d = buildRunDetail(events, snapshot({ stats: { launches: 0, merges: 1, supernovas: 0, maxChain: 3 } }), META);
    expect(d.maxChain).toBe(3);
  });
  it('1 投も無ければ 1 投あたりの得点は 0', () => {
    const d = buildRunDetail([], snapshot({ score: 500 }), META);
    expect(d.launches).toBe(0);
    expect(d.scorePerLaunch).toBe(0);
  });
  it('overLimitEnd の無いままゲームが続いても、最後の tick まで数える', () => {
    const events = [event('overLimitStart', 10)];
    const d = buildRunDetail(events, snapshot({ tick: 70 }), META);
    expect(d.overLimitSeconds).toBeCloseTo(60 / TICK_HZ, 10);
  });
});

describe('壊れた入力を通さない', () => {
  it('無限・非整数・範囲外の値は落とすか丸め、出来事そのものは数える', () => {
    const events = [
      event('merge', 5, { sourceTier: 0, chain: 2.9, scoreDelta: 100.7 }),
      event('merge', 6, { sourceTier: asTier(9), chain: Infinity, scoreDelta: Infinity }),
      event('merge', 7, { sourceTier: asTier(-1) }),
      event('land', 8, { impactSpeed: NaN }),
      event('land', 9, { impactSpeed: Infinity }),
    ];
    const d = buildRunDetail(events, snapshot({ stats: { launches: 0, merges: 3, supernovas: 0, maxChain: 0 } }), META);
    expect(d.merges).toBe(3); // 合体そのものは数える
    expect(d.mergesByTier[0]).toBe(1); // Tier の内訳は範囲内だけ
    expect(d.mergesByTier.reduce((a, b) => a + b, 0)).toBe(1);
    expect(d.maxChain).toBe(2); // 2.9 は切り捨て、Infinity は落とす
    expect(d.maxSingleScore).toBe(100); // 100.7 は切り捨て、Infinity は落とす
    expect(d.maxImpactSpeed).toBe(0); // NaN・Infinity は落とす
    expect(readRunDetail(d)).not.toBeNull();
  });
  it('負や NaN の盤面の値は 0 にそろえ、Tier の範囲外は上端に丸める', () => {
    const d = buildRunDetail([], snapshot({
      tick: -50, score: -10, seed: NaN, bestTierThisRun: asTier(99),
      stats: { launches: 0, merges: 0, supernovas: 0, maxChain: Infinity },
    }), META);
    expect(d.seconds).toBe(0);
    expect(d.score).toBe(0);
    expect(d.seed).toBe(0);
    expect(d.bestTier).toBe(TIER_COUNT - 1);
    expect(d.maxChain).toBe(0);
    expect(readRunDetail(d)).not.toBeNull();
  });
  it('逆順の限界区間は負にせず 0 として数える', () => {
    const events = [event('overLimitStart', 200), event('overLimitEnd', 100)];
    const d = buildRunDetail(events, snapshot({ tick: 300 }), META);
    expect(d.overLimitSeconds).toBe(0);
    expect(d.overLimitEntries).toBe(1);
  });
  it('重複した overLimitStart は越え始めの回数も区間もずらさない', () => {
    const events = [event('overLimitStart', 10), event('overLimitStart', 20), event('overLimitEnd', 40)];
    const d = buildRunDetail(events, snapshot({ tick: 40 }), META);
    expect(d.overLimitEntries).toBe(1);
    expect(d.overLimitSeconds).toBeCloseTo(30 / TICK_HZ, 10);
  });
  it('start の無い overLimitEnd は無視する', () => {
    const d = buildRunDetail([event('overLimitEnd', 50)], snapshot({ tick: 100 }), META);
    expect(d.overLimitEntries).toBe(0);
    expect(d.overLimitSeconds).toBe(0);
  });
  it('読めない時刻の限界出来事は区間を汚さず、統計は保存できる形に残る', () => {
    const events = [
      event('overLimitStart', 10),
      event('overLimitEnd', 40), // 30 tick 有効
      event('overLimitStart', NaN), // 時刻が読めない → 出来事ごと捨てる
      event('overLimitStart', 100),
      event('overLimitEnd', Infinity), // 読めない end は「来ない」のと同じ → 区間は開いたまま
      event('overLimitEnd', -50), // 負は 0 に丸める → 100 - 0 は負なので 0 tick、区間は閉じる
      event('overLimitStart', 200), // 新しい区間（終了まで開きっぱなし）
    ];
    const d = buildRunDetail(events, snapshot({ tick: 300 }), META);
    expect(d.overLimitEntries).toBe(3); // tick 10, 100, 200
    // 有効な区間: 10〜40 の 30 tick + 200〜300 の 100 tick（100〜0 は負なので 0）
    expect(d.overLimitSeconds).toBeCloseTo(130 / TICK_HZ, 10);
    expect(Number.isFinite(d.overLimitSeconds)).toBe(true);
    expect(readRunDetail(d)).not.toBeNull();
  });
  it('盤面の集計と識別情報が欠けていても、検査を通る値に仕上げる', () => {
    const snap = snapshot({ stats: undefined });
    const d = buildRunDetail(
      [event('merge', 5, { chain: 4, scoreDelta: 50 })],
      snap,
      { id: 'meta', playedAt: 'not-a-date', gameVersion: '0.1.0' },
    );
    expect(d.maxChain).toBe(4); // 出来事側の連鎖は残る
    expect(d.score).toBe(50); // 得点の下限は記録の合計
    expect(d.seconds).toBeCloseTo(5 / TICK_HZ, 10); // 出来事の時刻がプレイ時間の下限になる
    expect(d.playedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(readRunDetail(d)).not.toBeNull();
  });
  it('出来事の列に壊れた要素や未知の種類が混ざっていても、読める分だけ数える', () => {
    const events = [
      event('launch', 1),
      null,
      undefined,
      42,
      'broken',
      { sequence: 9, tick: 5 }, // kind の無い物
      { sequence: 10, tick: 5, kind: 'unknownKind' }, // 未来の版で増えた種類
      event('merge', 10, { sourceTier: 0, chain: 1, scoreDelta: 50 }),
    ] as unknown as GameEvent[];
    const d = buildRunDetail(events, snapshot({}), META);
    expect(d.launches).toBe(1);
    expect(d.merges).toBe(1);
    expect(d.mergesByTier[0]).toBe(1);
    expect(readRunDetail(d)).not.toBeNull();
  });
  it('出来事の最遅時刻が盤面を越えるときは、盤面が古い証拠として出来事側の時刻まで数える', () => {
    // 終了 tick 1000 の出来事が残る以上、プレイは少なくとも 1000 tick 続いた。
    // 「盤面の終了時刻」より後に閉じる区間も、実際にはプレイ時間内に収まる
    const events = [event('overLimitStart', 10), event('overLimitEnd', 1000)];
    const d = buildRunDetail(events, snapshot({ tick: 300 }), META);
    expect(d.seconds).toBeCloseTo(1000 / TICK_HZ, 10);
    expect(d.overLimitSeconds).toBeCloseTo(990 / TICK_HZ, 10);
    expect(d.overLimitSeconds).toBeLessThanOrEqual(d.seconds);
  });
  it('区間がすべて盤面の時刻より後でも、その時刻まで続いた扱いで丸ごと数える', () => {
    const events = [event('overLimitStart', 500), event('overLimitEnd', 600)];
    const d = buildRunDetail(events, snapshot({ tick: 300 }), META);
    expect(d.seconds).toBeCloseTo(600 / TICK_HZ, 10);
    expect(d.overLimitSeconds).toBeCloseTo(100 / TICK_HZ, 10);
    expect(d.overLimitEntries).toBe(1);
  });
  it('出来事の時刻が前後して区間が重なっても、実際に越えていた時間を越えて数えない', () => {
    const events = [
      event('overLimitStart', 10),
      event('overLimitEnd', 90), // [10, 90]
      event('overLimitStart', 20),
      event('overLimitEnd', 80), // [20, 80] は前の区間に内包
      event('overLimitStart', 40), // 開き [40, 300] も前の区間と重なる
    ];
    const d = buildRunDetail(events, snapshot({ tick: 300 }), META);
    expect(d.overLimitEntries).toBe(3);
    // 和集合は [10, 300] = 290 tick（区間をそのまま足すと 80 + 60 + 260 = 400 に膨らむ）
    expect(d.overLimitSeconds).toBeCloseTo(290 / TICK_HZ, 10);
    expect(d.overLimitSeconds).toBeLessThanOrEqual(d.seconds);
  });
  it('出来事の列が配列でなくても、0 件として仕上げる', () => {
    const d = buildRunDetail(null as unknown as GameEvent[], snapshot({ tick: 120 }), META);
    expect(d.launches).toBe(0);
    expect(d.seconds).toBeCloseTo(120 / TICK_HZ, 10);
    expect(readRunDetail(d)).not.toBeNull();
  });
  it('盤面と識別情報がまるごと欠けても落ちない（id は捏造しないので保存側で捨てられる）', () => {
    const d = buildRunDetail(
      [],
      null as unknown as GameSnapshot,
      null as unknown as typeof META,
    );
    expect(d.score).toBe(0);
    expect(d.seconds).toBe(0);
    expect(d.id).toBe('');
    expect(readRunDetail(d)).toBeNull();
  });
});

describe('盤面の集計との照合', () => {
  it('合体の出来事が示す到達 Tier が盤面を上回るときは、出来事側を採る', () => {
    // 盤面の集計が欠けた・古い版の記録でも、「この Tier が生まれた」出来事は到達の証拠。
    // 逆に出来事が示さない分（待ち行列から直接落ちた高い Tier 等）は盤面側が担う
    const d = buildRunDetail(
      [event('merge', 5, { sourceTier: 3, resultTier: 4 })],
      snapshot({ bestTierThisRun: 2 }),
      META,
    );
    expect(d.bestTier).toBe(4);
  });
  it('出来事の取りこぼしで数が足りない時は、盤面の集計を採る', () => {
    const d = buildRunDetail(
      [event('launch', 1), event('merge', 5, { sourceTier: 0, chain: 1, scoreDelta: 100 })],
      snapshot({ tick: 600, score: 900, stats: { launches: 5, merges: 3, supernovas: 1, maxChain: 4 } }),
      META,
    );
    expect(d.launches).toBe(5);
    expect(d.merges).toBe(3);
    expect(d.supernovas).toBe(1);
    expect(d.maxChain).toBe(4);
    expect(d.score).toBe(900); // 出来事の合計（100）より盤面が大きいので盤面側
    // lands に対応する集計は盤面に無いので、出来事側の数のまま
    expect(d.lands).toBe(0);
    // 1 投あたりの得点も、補った後の投数で割る
    expect(d.scorePerLaunch).toBeCloseTo(180, 10);
    expect(readRunDetail(d)).not.toBeNull();
  });
  it('出来事の方が多い時は出来事側を信じる（集計の欠損で減らさない）', () => {
    const d = buildRunDetail(
      [event('launch', 1), event('launch', 2), event('merge', 3, { sourceTier: 0, chain: 2, scoreDelta: 50 })],
      snapshot({ stats: { launches: 1, merges: 0, supernovas: 0, maxChain: 0 } }),
      META,
    );
    expect(d.launches).toBe(2);
    expect(d.merges).toBe(1);
    expect(d.maxChain).toBe(2);
  });
  it('盤面の得点・時刻が欠けていても、出来事が証明する分だけ残る', () => {
    const d = buildRunDetail(
      [
        event('merge', 300, { sourceTier: 0, resultTier: 1, chain: 1, scoreDelta: 330 }),
        event('supernova', 600, { sourceTier: 8, chain: 2, scoreDelta: 45000 }),
      ],
      snapshot({}), // tick・得点・集計が全部欠けた盤面
      META,
    );
    // 得点は合体・超新星でしか増えないので、記録の合計は「少なくともこれだけ取った」証拠
    expect(d.score).toBe(45330);
    // 出来事の最遅時刻までプレイは進んでいた
    expect(d.seconds).toBeCloseTo(600 / TICK_HZ, 10);
    expect(readRunDetail(d)).not.toBeNull();
  });
  it('負の scoreDelta は得点の証拠にしない（減ることのない得点を下げない）', () => {
    const d = buildRunDetail(
      [event('merge', 10, { sourceTier: 0, scoreDelta: -50 })],
      snapshot({ score: 100 }),
      META,
    );
    expect(d.score).toBe(100);
    expect(d.maxSingleScore).toBe(0); // 負は最大の単発得点にもならない
  });
  it('盤面の tick が無くても、開いた限界区間は出来事の最遅時刻まで数える', () => {
    const d = buildRunDetail(
      [event('overLimitStart', 10), event('land', 100, { impactSpeed: 300 })],
      snapshot({}), // tick が欠けた盤面
      META,
    );
    expect(d.seconds).toBeCloseTo(100 / TICK_HZ, 10);
    expect(d.overLimitSeconds).toBeCloseTo(90 / TICK_HZ, 10);
    expect(d.maxImpactSpeed).toBe(300);
  });
  it('終了の盤面が限界超過中なのに開いた区間が無い時は、越えた回数だけ立てる', () => {
    // 最後の overLimitStart だけ取りこぼした形。時刻は分からないので秒数は足さない
    const lost = buildRunDetail(
      [event('overLimitStart', 10), event('overLimitEnd', 40)],
      snapshot({ tick: 100, overLimit: true }),
      META,
    );
    expect(lost.overLimitEntries).toBe(2);
    expect(lost.overLimitSeconds).toBeCloseTo(30 / TICK_HZ, 10);
    // 区間が開いたまま終わる通常の形では、回数を増やさない
    const open = buildRunDetail(
      [event('overLimitStart', 10)],
      snapshot({ tick: 100, overLimit: true }),
      META,
    );
    expect(open.overLimitEntries).toBe(1);
    expect(open.overLimitSeconds).toBeCloseTo(90 / TICK_HZ, 10);
  });
  it('限界出来事の時刻がどれだけ乱れていても、1 tick ずつ覆って数えた時間と一致する', () => {
    // 和集合の潰し方を、別の計算（各 tick がどれかの区間に入るか全数え）で確かめる。
    // 区間の対づけは実装と同じ規則（越えていない→越えたで開く、越えている→越えてないで閉じる）
    let s = 20261016;
    const rand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const snapTick = 500;
    const events: GameEvent[] = [];
    const intervals: { from: number; to: number }[] = [];
    let open: number | null = null;
    let lastTick = 0;
    for (let i = 0; i < 400; i++) {
      const t = Math.floor(rand() * (snapTick + 200)); // 盤面の終了を越える時刻も混ぜる
      if (t > lastTick) lastTick = t;
      if (rand() < 0.5) {
        events.push(event('overLimitStart', t));
        if (open === null) open = t;
      } else {
        events.push(event('overLimitEnd', t));
        if (open !== null) {
          intervals.push({ from: open, to: t });
          open = null;
        }
      }
    }
    // 出来事の最遅時刻が盤面を越えたときは、プレイ時間もそこまで延びる
    const endTick = Math.max(snapTick, lastTick);
    if (open !== null) intervals.push({ from: open, to: endTick });
    let coveredTicks = 0;
    for (let t = 0; t < endTick; t++) {
      if (intervals.some((iv) => iv.from <= t && t < iv.to)) coveredTicks++;
    }
    const d = buildRunDetail(events, snapshot({ tick: snapTick }), META);
    expect(d.seconds).toBeCloseTo(endTick / TICK_HZ, 10);
    expect(d.overLimitSeconds).toBeCloseTo(coveredTicks / TICK_HZ, 10);
    expect(d.overLimitSeconds).toBeLessThanOrEqual(d.seconds);
    expect(readRunDetail(d)).not.toBeNull();
  });
});

describe('自動プレイとの照合', () => {
  it('自動プレイから作った統計が、出来事の数と盤面の集計に合う', () => {
    // 核の上に並べた Tier 0 2 体が最初の tick で合体する（必ず merge が出る）
    const auto = createAutoPlay(5, { bodies: [onCore(0, -1.6), onCore(0, -1.12)], queue: [0, 1, 2] });
    const events: GameEvent[] = [];
    for (let i = 0; i < 2400 && auto.sim.getSnapshot().phase === 'active'; i++) {
      events.push(...auto.step());
    }
    const snap = auto.sim.getSnapshot();
    const d = buildRunDetail(events, snap, { ...META, id: 'auto' });
    const count = (kind: GameEventKind) => events.filter((e) => e.kind === kind).length;
    expect(d.launches).toBeGreaterThan(0);
    expect(d.merges).toBeGreaterThan(0);
    expect(d.launches).toBe(count('launch'));
    expect(d.lands).toBe(count('land'));
    expect(d.merges).toBe(count('merge'));
    expect(d.supernovas).toBe(count('supernova'));
    expect(d.launches).toBe(snap.stats.launches);
    expect(d.merges).toBe(snap.stats.merges);
    expect(d.supernovas).toBe(snap.stats.supernovas);
    expect(d.maxChain).toBe(snap.stats.maxChain);
    expect(d.score).toBe(snap.score);
    expect(d.seconds).toBeCloseTo(snap.tick / TICK_HZ, 10);
    expect(d.bestTier).toBe(snap.bestTierThisRun);
    expect(d.overLimitSeconds).toBeGreaterThanOrEqual(0);
    expect(d.mergesByTier.reduce((a, b) => a + b, 0)).toBe(d.merges);
    expect(readRunDetail(d)).not.toBeNull();
  });
});

describe('速度', () => {
  it('1 万件の出来事を 1 プレイ分として畳み込んでも 50ms 以内', () => {
    const events: GameEvent[] = [];
    for (let i = 0; i < 2500; i++) {
      const t = i * 4;
      events.push(
        event('merge', t, { sourceTier: asTier(i % TIER_COUNT), chain: (i % 7) + 1, scoreDelta: 100 + i }),
        event('land', t + 1, { impactSpeed: 300 + (i % 400) }),
        event('overLimitStart', t + 2),
        event('overLimitEnd', t + 3),
      );
    }
    const t0 = performance.now();
    const d = buildRunDetail(events, snapshot({ tick: 10000 }), META);
    const elapsed = performance.now() - t0;
    expect(d.merges).toBe(2500);
    expect(d.overLimitEntries).toBe(2500);
    expect(elapsed).toBeLessThan(50);
  });
});
