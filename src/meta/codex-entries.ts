// 図鑑の項目の表。「見つけられる物」はすべてこのファイルに書く。
// 各項目は「見つかった瞬間の tick」を返す判定関数を持ち、
// 種類を足すときは表に 1 行足すだけ（評価・記録・保存・一覧は codex.ts 側でそのまま動く）。

import type { GameEvent, GameEventKind, GameSnapshot, Tier } from '../contracts/game';
import {
  CHAIN_MULT_MAX,
  CHAIN_WINDOW_SECONDS,
  HEAT_STATE_LIMITS,
  TICK_HZ,
  TIER_NAMES,
} from '../game/constants';
import type { CodexContext, CodexEntry } from './codex';
import { JST_OFFSET_MS } from './daily';

/** 偉業項目の目標値（meta 側の設計値なのでここにまとめる） */
const SCORE_MARKS = [10_000, 50_000, 100_000] as const;
const CROWD_BODIES = 20;
const OVERFLOW_BODIES = 30;
const MERGES_IN_RUN = 25;
const LAUNCHES_IN_RUN = 100;
const NOVAS_IN_RUN = 3;
const NOVA_CHAIN = 2;
const SURVIVE_TICKS = 3 * 60 * TICK_HZ; // 3 分
const QUIET_TICKS = 60 * TICK_HZ; // 1 分
/** 深夜の天文台の判定に使う時間帯（JST の 0 時台〜4 時台） */
const NIGHT_HOURS = [0, 5] as const;
const CRITICAL_HEAT = HEAT_STATE_LIMITS[2]; // 臨界の境目 75
const BRINK_HEAT = 90; // 終了（100）の寸前

// ── 判定の部品 ──

/** 条件に合う最初の出来事の tick。合う物が無ければ null。 */
const firstEventTick =
  (match: (e: GameEvent) => boolean) =>
  (ctx: CodexContext): number | null => {
    let tick: number | null = null;
    for (const e of ctx.events) {
      if (match(e) && (tick === null || e.tick < tick)) tick = e.tick;
    }
    return tick;
  };

const hasEvent = (kind: GameEventKind) => firstEventTick(e => e.kind === kind);

const chainAtLeast = (n: number) =>
  firstEventTick(e => (e.kind === 'merge' || e.kind === 'supernova') && (e.chain ?? 0) >= n);

/** 盤面だけで分かる項目。条件を満たせば現在の tick、満たさなければ null。 */
const snapshotWhen =
  (cond: (s: GameSnapshot) => boolean) =>
  (ctx: CodexContext): number | null =>
    cond(ctx.snapshot) ? ctx.snapshot.tick : null;

const scoreAtLeast = (score: number) => snapshotWhen(s => s.score >= score);

/**
 * 「越えた瞬間」が分かる時間のしきい値（tick は単調に増えるので）。
 * 発見 tick は観測時ではなく越えた瞬間そのものを指す（再生でその場面へ飛べる）。
 */
const tickAtLeast =
  (tick: number) =>
  (ctx: CodexContext): number | null =>
    ctx.snapshot.tick >= tick ? tick : null;

/**
 * 開始から静かな 1 分を越えたか。
 * 盤面だけで見ると「いま合体数 0」しか分からず、静かな 1 分のあとに合体したプレイは
 * 終盤にまとめて feed されると永久に見逃される。そこで出来事の列から最初の合体を探し、
 * それが 1 分より後なら達成とみなす（合体の記録が無いのに統計だけ増えている場合は、
 * 証拠不足として見つからない）。
 */
const quietMinute = (ctx: CodexContext): number | null => {
  const s = ctx.snapshot;
  if (s.tick < QUIET_TICKS) return null;
  const firstMerge = firstEventTick(e => e.kind === 'merge' || e.kind === 'supernova')(ctx);
  if (firstMerge !== null) return firstMerge >= QUIET_TICKS ? QUIET_TICKS : null;
  return s.stats.merges === 0 ? QUIET_TICKS : null;
};

/**
 * 日本時間の深夜（0 時〜5 時前）に観測できたか。
 * 観測時刻が渡されていなければ判定しない（実時刻を見る項目はこれだけにする）。
 */
const observedAtNight = (ctx: CodexContext): number | null => {
  const ms = ctx.nowMs;
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const hour = new Date(ms + JST_OFFSET_MS).getUTCHours();
  return hour >= NIGHT_HOURS[0] && hour < NIGHT_HOURS[1] ? ctx.snapshot.tick : null;
};

/**
 * Tier の天体が盤面に出たか。
 * 証拠は 3 つ: 撃った・着地した・合体の材料（sourceTier）、合体の産物（resultTier）、いま置いてある。
 * 出た瞬間を残すため、出来事の tick と天体の生まれた tick の早い方を返す。
 * どちらも無くても到達済み Tier より下なら出たとみなす（その場合は現在 tick）。
 */
const bodyAppeared =
  (tier: Tier) =>
  (ctx: CodexContext): number | null => {
    let tick: number | null = null;
    const consider = (t: number): void => {
      if (Number.isFinite(t) && (tick === null || t < tick)) tick = t;
    };
    for (const e of ctx.events) {
      if (e.sourceTier === tier || e.resultTier === tier) consider(e.tick);
    }
    for (const b of ctx.snapshot.bodies) {
      if (b.tier === tier) consider(b.bornTick);
    }
    if (tick !== null) return tick;
    return ctx.snapshot.bestTierThisRun >= tier ? ctx.snapshot.tick : null;
  };

// ── 図鑑の表（ここにだけ項目を書く） ──

const TIER_DESCRIPTIONS = [
  'いちばん小さい天体。すべてはここから始まる',
  '小粒子どうしが出会って生まれる',
  '隕石が育った姿。ここから合体の階段が続く',
  '惑星のそばに置かれる小さな伴星',
  '惑星の卵。山の中核になりやすい',
  'ひとつの完成形。ここから先は苦行',
  '盤面を支配し始める大物',
  '輝き始めた巨大天体',
  '最大の天体。どうしが触れると超新星になる',
] as const;

const BODY_ENTRIES: CodexEntry[] = TIER_NAMES.map((name, index) => ({
  id: `body-t${index}`,
  category: 'body',
  name,
  description: TIER_DESCRIPTIONS[index] ?? '',
  hint:
    index === 0
      ? 'プレイを始めると盤面にいる天体'
      : `Tier ${index - 1} の天体どうしを合体させる`,
  found: bodyAppeared(index as Tier),
}));

const EVENT_ENTRIES: CodexEntry[] = [
  { id: 'evt-launch', category: 'event', name: '初めての射出', description: '天体を盤面へ撃ち込んだ',
    hint: '盤面を押して離し、天体を撃つ', found: hasEvent('launch') },
  { id: 'evt-land', category: 'event', name: '初めての着地', description: '撃った天体が何かに触れて止まった',
    hint: '撃った天体を核か山に届かせる', found: hasEvent('land') },
  { id: 'evt-merge', category: 'event', name: '初めての合体', description: '同じ Tier どうしが触れて 1 つ上の天体になった',
    hint: '同じ天体どうしを触れさせる', found: hasEvent('merge') },
  { id: 'evt-supernova', category: 'event', name: '超新星', description: 'Tier 8 どうしが消え、熱量が大きく下がった',
    hint: 'Tier 8 の天体を 2 体作り、触れさせる', found: hasEvent('supernova') },
  { id: 'evt-overlimit', category: 'event', name: '限界突破', description: '山が限界リングを越え、熱量が上がり始めた',
    hint: '山を限界リングの外まで積み上げる', found: hasEvent('overLimitStart') },
  { id: 'evt-recover', category: 'event', name: '立て直し', description: '限界を越えたあと、山をリングの内側へ戻した',
    hint: '限界を越えたあと、はみ出した天体を消す', found: hasEvent('overLimitEnd') },
  { id: 'evt-gameover', category: 'event', name: '初めての終わり', description: '熱量が限界に達して終了した',
    hint: '熱量 100 で終わるところまで遊ぶ', found: hasEvent('gameOver') },
];

const CHAIN_ENTRIES: CodexEntry[] = ([2, 3, 4, 5] as const).map(n => ({
  id: `feat-chain-${n}`,
  category: 'feat' as const,
  name: `${n} 連鎖`,
  description:
    n === 5
      ? `倍率 ${CHAIN_MULT_MAX} に達する連鎖。合体が次の合体を呼んだ`
      : `合体のあと ${CHAIN_WINDOW_SECONDS} 秒以内に、生まれた天体がまた合体した`,
  hint: `合体のあと ${CHAIN_WINDOW_SECONDS} 秒以内に次の合体を起こす`,
  found: chainAtLeast(n),
}));

const FEAT_ENTRIES: CodexEntry[] = [
  ...CHAIN_ENTRIES,
  ...SCORE_MARKS.map(
    (mark): CodexEntry => ({
      id: `feat-score-${mark}`,
      category: 'feat',
      name: `${mark.toLocaleString('ja-JP')} 点`,
      description: `1 プレイで ${mark.toLocaleString('ja-JP')} 点に届いた`,
      hint: `1 プレイで ${mark.toLocaleString('ja-JP')} 点を取る`,
      found: scoreAtLeast(mark),
    }),
  ),
  { id: 'feat-crowd', category: 'feat', name: '満員御礼', description: `${CROWD_BODIES} 体の天体が同時に盤面に並んだ`,
    hint: `天体を ${CROWD_BODIES} 体同時に盤面へ置く`, found: snapshotWhen(s => s.bodies.length >= CROWD_BODIES) },
  { id: 'feat-overflow', category: 'feat', name: '大混雑', description: `${OVERFLOW_BODIES} 体もの天体が同時に盤面を埋めた`,
    hint: `天体を ${OVERFLOW_BODIES} 体同時に盤面へ置く`, found: snapshotWhen(s => s.bodies.length >= OVERFLOW_BODIES) },
  { id: 'feat-merges', category: 'feat', name: '量産体制', description: `1 プレイで ${MERGES_IN_RUN} 回合体させた`,
    hint: `1 プレイで ${MERGES_IN_RUN} 回合体させる`, found: snapshotWhen(s => s.stats.merges >= MERGES_IN_RUN) },
  { id: 'feat-launches', category: 'feat', name: '百発運用', description: `1 プレイで ${LAUNCHES_IN_RUN} 回、天体を撃ち続けた`,
    hint: `1 プレイで ${LAUNCHES_IN_RUN} 回撃つ`, found: snapshotWhen(s => s.stats.launches >= LAUNCHES_IN_RUN) },
  { id: 'feat-survive', category: 'feat', name: '長距離運行', description: '1 プレイで 3 分間生き残った',
    hint: '1 プレイで 3 分間、終わらずに遊ぶ', found: tickAtLeast(SURVIVE_TICKS) },
  { id: 'feat-quiet', category: 'feat', name: '沈黙の運行', description: '開始から 1 分間、一度も合体せずに持ちこたえた',
    hint: '合体させずに 1 分間生き残る', found: quietMinute },
  { id: 'feat-night-owl', category: 'feat', name: '深夜の天文台', description: '日本時間の深夜（0 時〜5 時）に観測を続けた',
    hint: '日本時間の深夜にプレイする', found: observedAtNight },
  { id: 'feat-critical', category: 'feat', name: '臨界体験', description: `熱量が ${CRITICAL_HEAT} を越える「臨界」に達した`,
    hint: `熱量を ${CRITICAL_HEAT} まで上げて生き残る`, found: snapshotWhen(s => s.heat >= CRITICAL_HEAT) },
  { id: 'feat-brink', category: 'feat', name: '九死一生', description: `熱量が ${BRINK_HEAT} を越えたのに、まだ終わっていない`,
    hint: `熱量 ${BRINK_HEAT} を越えても終わらずに持ちこたえる`,
    found: snapshotWhen(s => s.phase === 'active' && s.heat >= BRINK_HEAT) },
  { id: 'feat-nova-chain', category: 'feat', name: '連鎖超新星', description: '連鎖の勢いのまま、恒星級天体どうしが消えた',
    hint: '連鎖の中で超新星を起こす',
    found: firstEventTick(e => e.kind === 'supernova' && (e.chain ?? 0) >= NOVA_CHAIN) },
  { id: 'feat-triple-nova', category: 'feat', name: '超新星三昧', description: `1 プレイで ${NOVAS_IN_RUN} 度の超新星を起こした`,
    hint: `1 プレイで超新星を ${NOVAS_IN_RUN} 回起こす`, found: snapshotWhen(s => s.stats.supernovas >= NOVAS_IN_RUN) },
];

export const CODEX_ENTRIES: readonly CodexEntry[] = [
  ...BODY_ENTRIES,
  ...EVENT_ENTRIES,
  ...FEAT_ENTRIES,
];
