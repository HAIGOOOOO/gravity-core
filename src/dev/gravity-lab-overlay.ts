// 見本ページ「重力をいじる 3 方式」の、盤面に重ねる目印（井戸の場所、握りで寄る相手、渦の向き）。
// 盤面そのものの描画（担当 B の部品）には手を入れず、上にもう 1 枚の Canvas を重ねている。

import type { AimView } from '../contracts/app';
import type { GameSnapshot } from '../contracts/game';
import { LAUNCH_RADIUS, LIMIT_RADIUS, WELL_SOFT_RADIUS } from '../game/constants';
import { applyLogicalTransform, fitCanvas } from '../shared/coords';

const LINK_COLOR = '#FFD66B';
const WELL_COLOR = '#A38BFF';
const VORTEX_COLOR = '#83D9FF';
const AIM_COLOR = '#F7F7F2';

export type OverlayFrame = {
  snap: GameSnapshot;
  aim: AimView | null;
  aimGuide: boolean;
  /** 井戸が効く秒数（残り時間の弧の長さに使う） */
  wellSeconds: number;
  /** 井戸を置く場所を選んでいる最中の、ポインターの位置（論理座標） */
  wellPreview: { x: number; y: number; radius: number; ok: boolean } | null;
};

export function createOverlay(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;

  /** 握り: いま離したら寄る相手どうしを線でつなぐ（各天体から、いちばん近い同じ Tier へ）。 */
  function drawLinks(snap: GameSnapshot, range: number, strong: boolean): void {
    const bodies = snap.bodies;
    ctx.strokeStyle = LINK_COLOR;
    ctx.lineWidth = strong ? 4 : 2.5;
    ctx.globalAlpha = strong ? 0.9 : 0.6;
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i]!;
      let best = -1;
      let bestGap = range;
      for (let j = 0; j < bodies.length; j++) {
        const b = bodies[j]!;
        if (i === j || b.tier !== a.tier) continue;
        const gap = Math.hypot(b.x - a.x, b.y - a.y) - a.radius - b.radius;
        if (gap < bestGap) {
          bestGap = gap;
          best = j;
        }
      }
      if (best < 0) continue;
      const b = bodies[best]!;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawWell(x: number, y: number, radius: number, left01: number, alpha: number): void {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = WELL_COLOR;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 8]);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = WELL_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    // 残り時間を、中心のまわりの弧で見せる
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, WELL_SOFT_RADIUS, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left01);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** 渦: 限界リングの少し外に、回る向きの矢印を出す。強さは濃さで見せる。 */
  function drawVortex(spin: number): void {
    const r = LIMIT_RADIUS + 34;
    const sign = spin > 0 ? 1 : -1;
    ctx.globalAlpha = 0.25 + 0.75 * Math.abs(spin);
    ctx.strokeStyle = VORTEX_COLOR;
    ctx.fillStyle = VORTEX_COLOR;
    ctx.lineWidth = 3;
    for (const start of [0.3, 2.4, 4.5]) {
      const from = start;
      const to = start + sign * 0.7;
      ctx.beginPath();
      ctx.arc(0, 0, r, from, to, sign < 0);
      ctx.stroke();
      const hx = r * Math.cos(to);
      const hy = r * Math.sin(to);
      // 矢じりは、進む向き（接線）へ向ける
      const tx = -Math.sin(to) * sign;
      const ty = Math.cos(to) * sign;
      ctx.beginPath();
      ctx.moveTo(hx + tx * 16, hy + ty * 16);
      ctx.lineTo(hx - ty * 9, hy + tx * 9);
      ctx.lineTo(hx + ty * 9, hy - tx * 9);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function draw(frame: OverlayFrame): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    applyLogicalTransform(ctx);
    const g = frame.snap.gravity;
    if (g) {
      if (g.grip.pullRange > 0) drawLinks(frame.snap, g.grip.pullRange, !g.grip.held);
      if (g.well) drawWell(g.well.x, g.well.y, g.well.radius, Math.min(1, g.well.leftSeconds / frame.wellSeconds), 0.9);
      if (g.vortex.spin !== 0) drawVortex(g.vortex.spin);
    }
    const w = frame.wellPreview;
    if (w) drawWell(w.x, w.y, w.radius, 1, w.ok ? 0.55 : 0.2);

    // 山が動いている間の照準: 道すじの出だしだけを短く出す。着く場所の輪は出さない（言い切れないため）
    const p = frame.aim?.prediction;
    if (frame.aimGuide && p && p.uncertain && p.points.length > 1) {
      ctx.strokeStyle = AIM_COLOR;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 9]);
      ctx.beginPath();
      ctx.moveTo(p.points[0]!.x, p.points[0]!.y);
      for (const pt of p.points) ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    // 射出リングの外は使わないので、井戸を置ける範囲の目安にもなる
    if (w) {
      ctx.strokeStyle = WELL_COLOR;
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, LAUNCH_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  return { resize: (cssSize: number) => void fitCanvas(canvas, cssSize), draw };
}
