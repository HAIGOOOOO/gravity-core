// 【仮実装】担当 C が SPEC.md 8.1・8.3・8.5 のとおりに作る。
// いまは何も描かない。関数名と引数は変えないこと。

import type { EffectsLayer } from '../contracts/app';
import { fitCanvas } from '../shared/coords';

/**
 * @param canvas      盤面の上に重ねた透明な Canvas（演出専用）
 * @param shakeTarget 揺らす対象（盤面と演出の Canvas を包む要素）。CSS の transform で揺らす
 */
export function createEffectsLayer(canvas: HTMLCanvasElement, shakeTarget: HTMLElement): EffectsLayer {
  void shakeTarget;
  return {
    resize: (cssSize) => void fitCanvas(canvas, cssSize),
    handleEvents() {},
    update() {},
    draw() {},
    playGameOver() {},
    setReducedMotion() {},
    clear() {},
  };
}
