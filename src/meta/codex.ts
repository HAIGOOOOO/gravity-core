// 図鑑。見つけた天体・出来事・偉業を記録する。
// 項目はすべて CODEX_ENTRIES の表 1 か所に書き、それぞれが「見つかったか」の判定関数を持つ。
// 種類を足すときは表に 1 行足すだけで、エンジン・保存・一覧表示は変えなくてよい。

import type { GameEvent, GameEventKind, GameSnapshot, Tier } from '../contracts/game';
import {
  CHAIN_MULT_MAX,
  CHAIN_WINDOW_SECONDS,
  HEAT_STATE_LIMITS,
  TICK_HZ,
  TIER_NAMES,
} from '../game/constants';
import { asObject, readStoredJson, writeStoredJson, type MetaStorage } from './storage';

const STORAGE_KEY = 'gravity-core:codex:v1';
/** 未発見の項目の表示名（名前自体を褒美にするため隠す） */
const HIDDEN_NAME = '？？？';
/** 偉業項目の目標値（meta 側の設計値なのでここにまとめる） */
const SCORE_MARKS = [10_000, 50_000, 100_000] as const;
const CROWD_BODIES = 20;
const MERGES_IN_RUN = 25;
const SURVIVE_TICKS = 3 * 60 * TICK_HZ; // 3 分
const CRITICAL_HEAT = HEAT_STATE_LIMITS[2]; // 臨界の境目 75

export type CodexCategory = 'body' | 'event' | 'feat';

/** 判定に渡す 1 プレイぶんの材料。 */
export type CodexContext = Readonly<{
  /** そのプレイでこれまでに起きた出来事（全部） */
  events: readonly GameEvent[];
  /** 最新の盤面 */
  snapshot: GameSnapshot;
}>;

/** 図鑑の項目の定義。表示名と説明は発見後だけ見せ、発見前は hint を出す。 */
export type CodexEntry = Readonly<{
  id: string;
  category: CodexCategory;
  name: string;
  description: string;
  /** 未発見の人への手がかり（「次に何を狙うか」が言える文にする） */
  hint: string;
  /** 見つかったかどうか */
  found(context: CodexContext): boolean;
}>;

/** 発見の記録。再生へ飛べるよう、どのプレイの何 tick 目かを残す。 */
export type CodexDiscovery = Readonly<{
  id: string;
  /** 発見した実時刻（ms） */
  foundAtMs: number;
  /** 何回目のプレイか（1 始まり） */
  runIndex: number;
  /** そのプレイの何 tick 目か */
  tick: number;
  /** そのプレイの記録 ID（再生へ飛ぶ用。あれば） */
  recordId?: string;
}>;

/** feed に渡す付帯情報。時刻は呼び出し側が渡す（純粋に保つため） */
export type CodexFeedMeta = Readonly<{
  runIndex: number;
  nowMs: number;
  recordId?: string;
}>;

/** 一覧表示用。未発見は name が隠され text が hint になる。 */
export type CodexItemView = Readonly<{
  id: string;
  category: CodexCategory;
  found: boolean;
  name: string;
  text: string;
  discovery: CodexDiscovery | null;
}>;

export interface CodexStore {
  /**
   * そのプレイの出来事の列と最新の盤面を流し込み、今回新しく見つかった項目を返す（永続化済み）。
   * tick を正確に残すため、出来事が起きたらすぐ（その tick のうちに）呼ぶこと。
   */
  feed(
    events: readonly GameEvent[],
    snapshot: GameSnapshot,
    meta: CodexFeedMeta,
  ): readonly CodexEntry[];
  isFound(id: string): boolean;
  discovery(id: string): CodexDiscovery | null;
  list(): readonly CodexItemView[];
  progress(): Readonly<{ found: number; total: number }>;
}

// ── 判定の部品 ──

const hasEvent =
  (kind: GameEventKind) =>
  (ctx: CodexContext): boolean =>
    ctx.events.some(e => e.kind === kind);

/** Tier の天体が盤面に出たか（撃った・着地した・合体の材料・合体で生まれた・いま置いてある）。 */
const bodyAppeared =
  (tier: Tier) =>
  (ctx: CodexContext): boolean =>
    ctx.snapshot.bestTierThisRun >= tier ||
    ctx.snapshot.bodies.some(b => b.tier === tier) ||
    ctx.events.some(e => e.sourceTier === tier || e.resultTier === tier);

const chainAtLeast =
  (n: number) =>
  (ctx: CodexContext): boolean =>
    ctx.events.some(e => (e.kind === 'merge' || e.kind === 'supernova') && (e.chain ?? 0) >= n);

const scoreAtLeast =
  (score: number) =>
  (ctx: CodexContext): boolean =>
    ctx.snapshot.score >= score;

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
    hint: `天体を ${CROWD_BODIES} 体同時に盤面へ置く`, found: ctx => ctx.snapshot.bodies.length >= CROWD_BODIES },
  { id: 'feat-merges', category: 'feat', name: '量産体制', description: `1 プレイで ${MERGES_IN_RUN} 回合体させた`,
    hint: `1 プレイで ${MERGES_IN_RUN} 回合体させる`, found: ctx => ctx.snapshot.stats.merges >= MERGES_IN_RUN },
  { id: 'feat-survive', category: 'feat', name: '長距離運行', description: '1 プレイで 3 分間生き残った',
    hint: '1 プレイで 3 分間、終わらずに遊ぶ', found: ctx => ctx.snapshot.tick >= SURVIVE_TICKS },
  { id: 'feat-critical', category: 'feat', name: '臨界体験', description: `熱量が ${CRITICAL_HEAT} を越える「臨界」に達した`,
    hint: `熱量を ${CRITICAL_HEAT} まで上げて生き残る`, found: ctx => ctx.snapshot.heat >= CRITICAL_HEAT },
];

export const CODEX_ENTRIES: readonly CodexEntry[] = [
  ...BODY_ENTRIES,
  ...EVENT_ENTRIES,
  ...FEAT_ENTRIES,
];

// ── 評価と保存 ──

/** 表をなめて、いま見つかっている項目を全部返す（純粋。記録も表示もしない）。 */
export function evaluateCodex(
  context: CodexContext,
  entries: readonly CodexEntry[] = CODEX_ENTRIES,
): readonly CodexEntry[] {
  return entries.filter(entry => entry.found(context));
}

function restoreDiscoveries(value: unknown): Map<string, CodexDiscovery> {
  const map = new Map<string, CodexDiscovery>();
  const data = asObject(value);
  if (data.version !== 1) return map;
  for (const [id, raw] of Object.entries(asObject(data.found))) {
    const item = asObject(raw);
    const { foundAtMs, runIndex, tick, recordId } = item;
    if (typeof foundAtMs !== 'number' || !Number.isFinite(foundAtMs)) continue;
    if (typeof runIndex !== 'number' || !Number.isInteger(runIndex) || runIndex < 1) continue;
    if (typeof tick !== 'number' || !Number.isFinite(tick) || tick < 0) continue;
    map.set(id, {
      id,
      foundAtMs,
      runIndex,
      tick,
      recordId: typeof recordId === 'string' ? recordId : undefined,
    });
  }
  return map;
}

export function createCodexStore(
  storage: MetaStorage | null = null,
  entries: readonly CodexEntry[] = CODEX_ENTRIES,
): CodexStore {
  const discoveries = restoreDiscoveries(readStoredJson(storage, STORAGE_KEY));
  const persist = (): void =>
    writeStoredJson(storage, STORAGE_KEY, { version: 1, found: Object.fromEntries(discoveries) });

  return {
    feed(events, snapshot, meta) {
      const found: CodexEntry[] = [];
      for (const entry of entries) {
        if (discoveries.has(entry.id) || !entry.found({ events, snapshot })) continue;
        discoveries.set(entry.id, {
          id: entry.id,
          foundAtMs: Number.isFinite(meta.nowMs) ? meta.nowMs : 0,
          runIndex: Number.isInteger(meta.runIndex) && meta.runIndex >= 1 ? meta.runIndex : 1,
          tick: Number.isFinite(snapshot.tick) ? snapshot.tick : 0,
          recordId: typeof meta.recordId === 'string' ? meta.recordId : undefined,
        });
        found.push(entry);
      }
      if (found.length > 0) persist();
      return found;
    },
    isFound: id => discoveries.has(id),
    discovery: id => discoveries.get(id) ?? null,
    list() {
      return entries.map(entry => {
        const discovery = discoveries.get(entry.id) ?? null;
        const found = discovery !== null;
        return {
          id: entry.id,
          category: entry.category,
          found,
          name: found ? entry.name : HIDDEN_NAME,
          text: found ? entry.description : entry.hint,
          discovery,
        };
      });
    },
    progress: () => ({
      found: entries.filter(entry => discoveries.has(entry.id)).length,
      total: entries.length,
    }),
  };
}
