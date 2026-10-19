// 【仮実装】担当 B が作り直す（docs/tasks/B.md）。
// いまは「遊べることを確かめる」ための最小の描画だけ。関数名と引数は変えないこと。

import type { BoardFrame, BoardRenderer } from '../contracts/app';
import { CORE_RADIUS, LAUNCH_RADIUS } from '../game/constants';
import { applyLogicalTransform, fitCanvas } from '../shared/coords';
import { HEAT_STATE_COLOR, heatState } from '../shared/heat';
import { drawBody } from './bodies';
import { createBoardForeground, drawBoardForeground } from './foreground';

export function createBoardRenderer(canvas: HTMLCanvasElement): BoardRenderer {
  const ctx = canvas.getContext('2d')!;
  const foreground = createBoardForeground(canvas), top = foreground?.getContext('2d');

  function draw(frame: BoardFrame): void {
    const { prev, curr, alpha } = frame;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#070B18';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    applyLogicalTransform(ctx);

    // 射出リング
    ctx.strokeStyle = 'rgba(57, 80, 106, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, LAUNCH_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    // 天体（前の tick の位置と補間）
    const before = new Map(prev.bodies.map((b) => [b.id, b]));
    for (const b of curr.bodies) {
      const p = before.get(b.id);
      const x = p ? p.x + (b.x - p.x) * alpha : b.x;
      const y = p ? p.y + (b.y - p.y) * alpha : b.y;
      drawBody(ctx, b.tier, x, y, b.radius, { seed: b.id, timeSeconds: frame.timeSeconds });
      if (b.overLimit) {
        ctx.strokeStyle = '#FF7D83';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, b.radius + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // 核と熱量リング
    ctx.fillStyle = '#FFB45E';
    ctx.beginPath();
    ctx.arc(0, 0, CORE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    if (curr.heat > 0) {
      ctx.strokeStyle = HEAT_STATE_COLOR[heatState(curr.heat)];
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, 0, CORE_RADIUS - 8, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * curr.heat) / 100);
      ctx.stroke();
    }

    if (foreground && top) {
      top.setTransform(1, 0, 0, 1, 0, 0); top.clearRect(0, 0, foreground.width, foreground.height);
      applyLogicalTransform(top); drawBoardForeground(top, frame);
    } else drawBoardForeground(ctx, frame);

    if (frame.dimmed) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = 'rgba(7, 11, 24, 0.5)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (foreground && top) { top.setTransform(1, 0, 0, 1, 0, 0); top.fillStyle = 'rgba(7,11,24,0.5)'; top.fillRect(0, 0, foreground.width, foreground.height); }
    }
  }

  return {
    resize(cssSize) { fitCanvas(canvas, cssSize); if (foreground) fitCanvas(foreground, cssSize); },
    draw,
  };
}
