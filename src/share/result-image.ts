import type { GameSnapshot } from '../contracts/game';
import { TICK_HZ, TIER_NAMES } from '../game/constants';
import { createBoardRenderer } from '../render';
import type { ReplayHighlight } from '../replay/highlights';

export type ResultImageSource = Readonly<{
  final: GameSnapshot;
  highlights: readonly ReplayHighlight[];
  sample?: boolean;
}>;

const WIDTH = 1080;
const HEIGHT = 1350;
const BOARD_SIZE = 744;
const INSET = 64;
const RIGHT = WIDTH - INSET;
const BOARD_TOP = 280;

function clock(tick: number): string {
  if (tick > 0 && tick < TICK_HZ) return '1秒未満';
  const seconds = Math.floor(tick / TICK_HZ);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function selectHighlights(highlights: readonly ReplayHighlight[]): ReplayHighlight[] {
  const priority = ['supernova', 'bestTier', 'maxChain', 'heatCritical', 'beforeGameOver'] as const;
  const chosen: ReplayHighlight[] = [];
  for (const kind of priority) {
    const candidate = highlights.find((h) => h.kind === kind &&
      (kind !== 'maxChain' || h.value > 1) && chosen.every((other) => other.tick !== h.tick));
    if (candidate) chosen.push(candidate);
    if (chosen.length === 3) break;
  }
  return chosen.sort((a, b) => a.tick - b.tick);
}

function highlightLabel(highlight: ReplayHighlight): string {
  switch (highlight.kind) {
    case 'supernova': return '超新星が発生';
    case 'bestTier': return `${TIER_NAMES[highlight.value]}が誕生`;
    case 'maxChain': return `${highlight.value}連鎖`;
    case 'heatCritical': return '熱量が臨界に達した';
    case 'beforeGameOver': return 'ゲーム終了の直前';
  }
}

/** 記録の最後の盤面を描き、結果画面と同じ色・書体で1枚にまとめる。 */
export function createResultImage({ final, highlights, sample = false }: ResultImageSource): {
  canvas: HTMLCanvasElement;
  description: string;
} {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');

  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
  const bg = token('--bg', '#070b18');
  const line = token('--line', '#39506a');
  const text = token('--text', '#f7f7f2');
  const muted = token('--text-sub', '#91a0b8');
  const warm = token('--core-hot', '#fff6d7');
  const cool = token('--cool', '#83d9ff');
  const font = token('--font', 'system-ui, sans-serif');
  ctx.textBaseline = 'alphabetic';
  const label = (value: string, x: number, y: number, size: number, color: string,
    options: { bold?: boolean; maxWidth?: number; align?: CanvasTextAlign } = {}): void => {
    ctx.font = `${options.bold ? 700 : 400} ${size}px ${font}`;
    ctx.textAlign = options.align ?? 'left';
    ctx.fillStyle = color;
    ctx.fillText(value, x, y, options.maxWidth);
  };
  const rule = (y: number): void => {
    ctx.fillStyle = line;
    ctx.fillRect(INSET, y, WIDTH - INSET * 2, 2);
  };

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const ending = final.phase === 'over' ? 'ゲーム終了' : 'プレイ途中';
  const score = `${final.score.toLocaleString('ja-JP')}点`;
  const summary = `${clock(final.tick)}  /  ${final.stats.launches}投`;
  label('GRAVITY CORE', INSET, 88, 39, text, { bold: true });
  const state = sample ? `見本 / ${ending}` : ending;
  label(state, RIGHT, 87, 29, muted, { align: 'right' });
  rule(115);
  label(final.phase === 'over' ? '最終スコア' : 'ここまでのスコア', INSET, 170, 30, muted);
  label(score, INSET, 246, 86, warm, { bold: true, maxWidth: 652 });
  label(summary, RIGHT, 244, 34, cool, { align: 'right' });

  const board = document.createElement('canvas');
  board.width = BOARD_SIZE;
  board.height = BOARD_SIZE;
  createBoardRenderer(board).draw({ prev: final, curr: final, alpha: 1,
    timeSeconds: final.tick / TICK_HZ, reducedMotion: true, aimGuide: false, dimmed: false, aim: null });
  ctx.drawImage(board, (WIDTH - BOARD_SIZE) / 2, BOARD_TOP);
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  ctx.strokeRect(INSET + 1, BOARD_TOP + 1, WIDTH - INSET * 2 - 2, BOARD_SIZE - 2);

  label('見どころ', INSET, 1090, 36, text, { bold: true });
  const rows = selectHighlights(highlights).map((h) => ({ time: clock(h.tick), text: highlightLabel(h) }));
  const empty = 'この記録には表示できる見どころがありません';
  if (rows.length === 0) label(empty, INSET, 1156, 32, muted);
  rows.forEach((row, index) => {
    const y = 1151 + index * 68;
    rule(y - 39);
    label(row.time, INSET, y, 33, cool);
    label(row.text, INSET + 147, y, 37, text, { maxWidth: WIDTH - INSET * 2 - 147 });
  });
  const details = rows.length ? rows.map((row) => `${row.time} ${row.text}`).join('。') : empty;
  return { canvas, description: `GRAVITY CORE。 ${state}、${score}、${summary}。最後の盤面。見どころ。 ${details}` };
}
