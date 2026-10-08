// 【仮実装】担当 B が SPEC.md 6.5・7.2・8.2 のとおりに作り直す。
// いまは「遊べることを確かめる」ための最小の描画だけ。関数名と引数は変えないこと。

import type { BoardFrame, BoardRenderer } from '../contracts/app';
import { CORE_RADIUS, LAUNCH_RADIUS, TIER_RADIUS } from '../game/constants';
import { applyLogicalTransform, fitCanvas } from '../shared/coords';
import { HEAT_STATE_COLOR, heatState } from '../shared/heat';
import { drawBody } from './bodies';

export function createBoardRenderer(canvas: HTMLCanvasElement): BoardRenderer {
  const ctx = canvas.getContext('2d')!;

  function draw(frame: BoardFrame): void {
    const { prev, curr, alpha, aim, guide } = frame;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#070B18';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    applyLogicalTransform(ctx);

    // 射出リング
    ctx.strokeStyle = 'rgba(57, 80, 106, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.arc(0, 0, LAUNCH_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 天体（前の tick の位置と補間）
    const before = new Map(prev.bodies.map((b) => [b.id, b]));
    for (const b of curr.bodies) {
      const p = before.get(b.id);
      const x = p ? p.x + (b.x - p.x) * alpha : b.x;
      const y = p ? p.y + (b.y - p.y) * alpha : b.y;
      drawBody(ctx, b.tier, x, y, b.radius, { seed: b.id, timeSeconds: frame.timeSeconds });
    }

    // 核と熱量リング
    ctx.fillStyle = '#FFB45E';
    ctx.beginPath();
    ctx.arc(0, 0, CORE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = HEAT_STATE_COLOR[heatState(curr.heat)];
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 60, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * curr.heat) / 100);
    ctx.stroke();

    // 初回の案内
    if (guide && !aim) {
      const gx = LAUNCH_RADIUS * Math.cos(guide.originAngleRadians);
      const gy = LAUNCH_RADIUS * Math.sin(guide.originAngleRadians);
      ctx.strokeStyle = '#F7F7F2';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(gx, gy, 18, 0, Math.PI * 2);
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + guide.dirX * 80, gy + guide.dirY * 80);
      ctx.stroke();
    }

    // 照準
    if (aim) {
      const ox = LAUNCH_RADIUS * Math.cos(aim.originAngleRadians);
      const oy = LAUNCH_RADIUS * Math.sin(aim.originAngleRadians);
      drawBody(ctx, aim.tier, ox, oy, TIER_RADIUS[aim.tier], { alpha: 0.6 });
      const p = aim.prediction;
      if (p && p.points.length > 1) {
        ctx.strokeStyle = aim.invalid || p.fate !== 'orbit' ? '#FF7D83' : '#F7F7F2';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.points[0]!.x, p.points[0]!.y);
        for (const pt of p.points) ctx.lineTo(pt.x, pt.y);
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
