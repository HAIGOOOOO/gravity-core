// 論理座標（中心が (0,0) の 960 × 960）と、画面上の位置との変換。全担当が使ってよい。

import { BOARD_SIZE, DPR_CAP } from '../game/constants';

/** Canvas の表示サイズと画素数をそろえる。戻り値は実際に使った画素密度。 */
export function fitCanvas(canvas: HTMLCanvasElement, cssSize: number): number {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, DPR_CAP);
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;
  canvas.width = Math.round(cssSize * dpr);
  canvas.height = Math.round(cssSize * dpr);
  return dpr;
}

/**
 * 以降の描画を論理座標で書けるようにする（中心が原点、960 が一辺）。
 * 毎フレームの描画の最初に呼ぶ。
 */
export function applyLogicalTransform(ctx: CanvasRenderingContext2D): void {
  const scale = ctx.canvas.width / BOARD_SIZE;
  ctx.setTransform(scale, 0, 0, scale, ctx.canvas.width / 2, ctx.canvas.height / 2);
}

/** ポインターの位置（clientX / clientY）を論理座標にする。 */
export function clientToLogical(canvas: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const scale = BOARD_SIZE / rect.width;
  return {
    x: (clientX - rect.left - rect.width / 2) * scale,
    y: (clientY - rect.top - rect.height / 2) * scale,
  };
}

/** CSS px の長さを論理座標の長さにする。 */
export function cssToLogicalLength(canvas: HTMLCanvasElement, cssPx: number): number {
  return (cssPx * BOARD_SIZE) / canvas.getBoundingClientRect().width;
}
