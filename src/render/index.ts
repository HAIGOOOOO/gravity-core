// 【仮実装】担当 B が作り直す（docs/tasks/B.md）。
// いまは「遊べることを確かめる」ための最小の描画だけ。関数名と引数は変えないこと。

import type { BoardFrame, BoardRenderer } from '../contracts/app';
import { CORE_RADIUS, LAUNCH_RADIUS, LIMIT_RADIUS, TIER_RADIUS } from '../game/constants';
import { applyLogicalTransform, fitCanvas } from '../shared/coords';
import { HEAT_STATE_COLOR, heatState } from '../shared/heat';
import { drawBody } from './bodies';

export function createBoardRenderer(canvas: HTMLCanvasElement): BoardRenderer {
  const ctx = canvas.getContext('2d')!;

  function draw(frame: BoardFrame): void {
    const { prev, curr, alpha, aim } = frame;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#070B18';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    applyLogicalTransform(ctx);

    // 限界リング（越えている間は赤く）
    ctx.strokeStyle = curr.overLimit ? '#FF7D83' : 'rgba(145, 160, 184, 0.7)';
    ctx.lineWidth = curr.overLimit ? 3 : 1.5;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.arc(0, 0, LIMIT_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

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

    // 照準
    if (aim) {
      const ox = LAUNCH_RADIUS * Math.cos(aim.originAngleRadians);
      const oy = LAUNCH_RADIUS * Math.sin(aim.originAngleRadians);
      drawBody(ctx, aim.tier, ox, oy, TIER_RADIUS[aim.tier], { alpha: 0.6 });
      const p = aim.prediction;
      if (frame.aimGuide && p && p.points.length > 1) {
        ctx.strokeStyle = aim.invalid ? '#FF7D83' : p.willMerge ? '#83D9FF' : '#F7F7F2';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(p.points[0]!.x, p.points[0]!.y);
        for (const pt of p.points) ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
        ctx.setLineDash([]);
        // 着く場所に、撃つ天体の大きさの輪を出す
        const last = p.points[p.points.length - 1]!;
        ctx.beginPath();
        ctx.arc(last.x, last.y, TIER_RADIUS[aim.tier], 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (frame.dimmed) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = 'rgba(7, 11, 24, 0.5)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  return {
    resize: (cssSize) => void fitCanvas(canvas, cssSize),
    draw,
  };
}
