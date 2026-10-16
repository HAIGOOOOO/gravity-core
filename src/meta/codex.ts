// 図鑑。見つけた天体・出来事・偉業を記録する。
// 「見つけられる物」の一覧と判定は codex-entries.ts の表 1 か所に書き、
// このファイルは表をなめるエンジン（評価・記録・保存・一覧）だけを持つ。
// 種類を足すときは表に 1 行足すだけで、こちらは変えなくてよい。

import type { GameEvent, GameSnapshot } from '../contracts/game';
import { CODEX_ENTRIES } from './codex-entries';
import { asObject, readStoredJson, writeStoredJson, type MetaStorage } from './storage';

export { CODEX_ENTRIES } from './codex-entries';

const STORAGE_KEY = 'gravity-core:codex:v1';
/** 未発見の項目の表示名（名前自体を褒美にするため隠す） */
const HIDDEN_NAME = '？？？';

export type CodexCategory = 'body' | 'event' | 'feat';

/** 判定に渡す 1 プレイぶんの材料。 */
export type CodexContext = Readonly<{
  /** そのプレイでこれまでに起きた出来事（全部） */
  events: readonly GameEvent[];
  /** 最新の盤面 */
  snapshot: GameSnapshot;
  /**
   * 観測した実時刻（ms）。実時刻で判定する項目（深夜に遊んだ等）だけが使う。
   * 渡さないと時刻条件の項目は見つからない（feed は meta.nowMs をそのまま渡す）。
   */
  nowMs?: number;
}>;

/** 図鑑の項目の定義。表示名と説明は発見後だけ見せ、発見前は hint を出す。 */
export type CodexEntry = Readonly<{
  id: string;
  category: CodexCategory;
  name: string;
  description: string;
  /** 未発見の人への手がかり（「次に何を狙うか」が言える文にする） */
  hint: string;
  /**
   * 見つかったかどうか。見つかっていれば「それが起きた tick」、なければ null。
   * 再生へ飛ぶ場所になるので、出来事ならその tick・盤面の天体なら生まれた tick・
   * 時間のしきい値なら越えた瞬間の tick を返す。越えた瞬間が分からない項目
   * （熱量・得点・混雑など）は、観測した盤面の現在 tick を返す。
   */
  found(context: CodexContext): number | null;
}>;

/** 発見の記録。再生へ飛べるよう、どのプレイの何 tick 目かを残す。 */
export type CodexDiscovery = Readonly<{
  id: string;
  /** 発見した実時刻（ms） */
  foundAtMs: number;
  /** 何回目のプレイか（1 始まり） */
  runIndex: number;
  /** 「それが起きた」tick（feed した時点ではない） */
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
  /**
   * 見つけたあと、まだ一覧で見ていない（NEW バッジ用）。
   * markAllSeen に渡した時刻より新しい発見が true になる。
   */
  isNew: boolean;
  discovery: CodexDiscovery | null;
}>;

/** カテゴリごとの進み具合（一覧画面の「天体 3/9」の内訳に使う） */
export type CodexCategoryProgress = Readonly<{ found: number; total: number }>;

export type CodexProgress = Readonly<{
  found: number;
  total: number;
  /** カテゴリ別の内訳。3 つのカテゴリは項目が 0 件でも必ず入る（表示側が分岐しないで済む） */
  categories: Readonly<Record<CodexCategory, CodexCategoryProgress>>;
}>;

export interface CodexStore {
  /**
   * そのプレイの出来事の列と最新の盤面を流し込み、今回新しく見つかった項目を返す（永続化済み）。
   * 出来事が起きたらすぐ（その tick のうちに）呼ぶこと。
   * 「越えた瞬間」が盤面から分からない項目（熱量・得点・混雑など）は、
   * 1 秒ごとなど定期的にも呼ぶと発見 tick が実際の瞬間に近づく。
   */
  feed(
    events: readonly GameEvent[],
    snapshot: GameSnapshot,
    meta: CodexFeedMeta,
  ): readonly CodexEntry[];
  isFound(id: string): boolean;
  discovery(id: string): CodexDiscovery | null;
  list(): readonly CodexItemView[];
  /**
   * 最近見つけた項目を新しい順に返す（「最近の発見」欄・NEW バッジ用）。
   * 発見時刻が同じ項目は表の順を保つ。limit は 0 以上の整数に丸める。
   * 今の表に無い項目（別の版で記録された物）は返さない。
   */
  latest(limit?: number): readonly CodexItemView[];
  progress(): CodexProgress;
  /**
   * 「見た」と記録した時刻より新しく見つかった項目の数（NEW バッジの数字に使う）。
   * 今の表に無い項目（別の版で記録された物）は数えない。
   */
  newCount(): number;
  /**
   * いま見つかっている項目を全部「見た」ことにする（図鑑画面を開いた・閉じたときに呼ぶ）。
   * 端末の時計が巻き戻っても記録は戻らない（消えたバッジが復活しないようにするため）。
   * 有限でない時刻は無視する。
   */
  markAllSeen(nowMs: number): void;
}

/** 表をなめて、いま見つかっている項目を全部返す（純粋。記録も表示もしない）。 */
export function evaluateCodex(
  context: CodexContext,
  entries: readonly CodexEntry[] = CODEX_ENTRIES,
): readonly CodexEntry[] {
  return entries.filter(entry => entry.found(context) !== null);
}

/** 発見 tick の後始末。計算できなければ盤面の tick、それも駄目なら 0。 */
function discoveryTick(tick: number | null, snapshot: GameSnapshot): number {
  if (typeof tick === 'number' && Number.isFinite(tick) && tick >= 0) return tick;
  return Number.isFinite(snapshot.tick) && snapshot.tick >= 0 ? snapshot.tick : 0;
}

/** 「一覧を見た」時刻。古い保存（キー無し）や壊れた値は 0 = 全部新しい扱いにする。 */
function restoreSeenMs(data: Record<string, unknown>): number {
  const raw = data.seenMs;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : 0;
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
  const stored = asObject(readStoredJson(storage, STORAGE_KEY));
  const discoveries = restoreDiscoveries(stored);
  let seenMs = restoreSeenMs(stored);
  const persist = (): void =>
    writeStoredJson(storage, STORAGE_KEY, {
      version: 1,
      found: Object.fromEntries(discoveries),
      seenMs,
    });

  const api: CodexStore = {
    feed(events, snapshot, meta) {
      const ctx: CodexContext = { events, snapshot, nowMs: meta.nowMs };
      const found: CodexEntry[] = [];
      for (const entry of entries) {
        if (discoveries.has(entry.id)) continue;
        const tick = entry.found(ctx);
        if (tick === null) continue;
        discoveries.set(entry.id, {
          id: entry.id,
          foundAtMs: Number.isFinite(meta.nowMs) ? meta.nowMs : 0,
          runIndex: Number.isInteger(meta.runIndex) && meta.runIndex >= 1 ? meta.runIndex : 1,
          tick: discoveryTick(tick, snapshot),
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
          isNew: discovery !== null && discovery.foundAtMs > seenMs,
          discovery,
        };
      });
    },
    latest(limit = 5) {
      const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
      // list() は表の順の新しい配列を返すので、そのまま安定ソートすると
      // 時刻順（同じ時刻なら表の順）になる
      return api
        .list()
        .filter(v => v.found)
        .sort((a, b) => (b.discovery?.foundAtMs ?? 0) - (a.discovery?.foundAtMs ?? 0))
        .slice(0, cap);
    },
    progress() {
      const categories: Record<CodexCategory, { found: number; total: number }> = {
        body: { found: 0, total: 0 },
        event: { found: 0, total: 0 },
        feat: { found: 0, total: 0 },
      };
      let found = 0;
      for (const entry of entries) {
        const c = categories[entry.category];
        if (c) c.total++;
        if (discoveries.has(entry.id)) {
          found++;
          if (c) c.found++;
        }
      }
      return { found, total: entries.length, categories };
    },
    newCount() {
      let n = 0;
      for (const entry of entries) {
        const d = discoveries.get(entry.id);
        if (d && d.foundAtMs > seenMs) n++;
      }
      return n;
    },
    markAllSeen(nowMs) {
      if (!Number.isFinite(nowMs) || nowMs <= seenMs) return;
      seenMs = nowMs;
      persist();
    },
  };
  return api;
}
