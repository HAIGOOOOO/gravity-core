// 記録を最後まで流して、見どころと思われる瞬間を tick 付きで拾う。
// 拾う物（いまのルールに合わせた 5 種）:
//   maxChain       最大の連鎖が起きた瞬間（記録の中で一番大きい chain の最初の 1 回）
//   bestTier       そのプレイの最高 Tier が初めて生まれた瞬間
//   supernova      超新星（Tier 8 どうしの合体）全部
//   heatCritical   熱量が「臨界」（HEAT_STATE_LIMITS の上から 2 番目）を越えた最初の瞬間
//   beforeGameOver ゲームオーバーの 10 秒前（負けた理由の巻き戻しの入口）

import type { Tick } from '../contracts/game';
import { HEAT_STATE_LIMITS, TICK_HZ } from '../game/constants';
import { runReplay, type ReplayFailure } from './engine';
import type { ReplayRecord } from './record';

export type HighlightKind = 'maxChain' | 'bestTier' | 'supernova' | 'heatCritical' | 'beforeGameOver';

export type ReplayHighlight = Readonly<{
  kind: HighlightKind;
  tick: Tick;
  /** 連鎖数・Tier・熱量・何回目の超新星か、など。kind ごとの意味は上の一覧 */
  value: number;
}>;

export type HighlightsResult = Readonly<{ ok: true; highlights: readonly ReplayHighlight[] }> | ReplayFailure;

/** ゲームオーバーの何秒前を「直前」とするか（題目の決まりは 10 秒）。 */
const BEFORE_GAME_OVER_SECONDS = 10;
/** 「臨界」の境目（75）。 */
const HEAT_CRITICAL = HEAT_STATE_LIMITS[2];

export function findHighlights(record: ReplayRecord): HighlightsResult {
  let heatTick: Tick | null = null;
  let heatValue = 0;
  const run = runReplay(record, {
    visit: (snap) => {
      if (heatTick === null && snap.heat > HEAT_CRITICAL) {
        heatTick = snap.tick;
        heatValue = snap.heat;
      }
    },
  });
  if (!run.ok) return run;

  const highlights: ReplayHighlight[] = [];
  let maxChain = 0;
  let maxChainTick: Tick | null = null;
  // 「最高 Tier が初めて生まれた瞬間」だけを拾うため、開始時点で既に届いていた
  // 最高 Tier を下限にする。setup で高 Tier から始まる記録で、途中の合体を
  // 「最高 Tier 誕生」と誤って拾わないため（checkpoints[0] は tick 0 の盤面）。
  let bestTier: number = run.checkpoints[0]?.bestTierThisRun ?? -1;
  let bestTierTick: Tick | null = null;
  let supernovaCount = 0;
  let gameOverTick: Tick | null = null;

  for (const { at, event } of run.events) {
    switch (event.kind) {
      case 'merge':
      case 'supernova': {
        const chain = event.chain ?? 0;
        if (chain > maxChain) {
          maxChain = chain;
          maxChainTick = at;
        }
        break;
      }
      default:
        break;
    }
    if (event.kind === 'merge' && event.resultTier !== undefined && event.resultTier > bestTier) {
      bestTier = event.resultTier;
      bestTierTick = at;
    }
    if (event.kind === 'supernova') {
      supernovaCount++;
      highlights.push({ kind: 'supernova', tick: at, value: supernovaCount });
    }
    if (event.kind === 'gameOver') gameOverTick = at;
  }

  if (maxChainTick !== null) highlights.push({ kind: 'maxChain', tick: maxChainTick, value: maxChain });
  if (bestTierTick !== null) highlights.push({ kind: 'bestTier', tick: bestTierTick, value: bestTier });
  // value は「境目」ではなく越えた瞬間の実熱量（巻き戻し先の危険度として渡す）
  if (heatTick !== null) highlights.push({ kind: 'heatCritical', tick: heatTick, value: heatValue });
  if (gameOverTick !== null) {
    highlights.push({
      kind: 'beforeGameOver',
      tick: Math.max(0, gameOverTick - BEFORE_GAME_OVER_SECONDS * TICK_HZ),
      value: gameOverTick,
    });
  }

  highlights.sort((a, b) => a.tick - b.tick);
  return { ok: true, highlights };
}
