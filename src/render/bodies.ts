// 【仮実装】担当 B が SPEC.md 4.2 の描き方に置き換える。
// 関数名と引数は変えないこと（担当 C・D もこの関数で天体を描く）。

import type { DrawBodyOptions } from '../contracts/app';
import type { Tier } from '../contracts/game';
import { TIER_COLOR } from '../game/constants';

/**
 * 天体を 1 個描く。座標と半径は、呼び出し側の ctx の座標系のまま使う
 * （盤面では論理座標、HUD の「次の天体」では CSS px）。
 */
export function drawBody(
  ctx: CanvasRenderingContext2D,
  tier: Tier,
  x: number,
  y: number,
  radius: number,
  options: DrawBodyOptions = {},
): void {
  ctx.save();
  ctx.globalAlpha *= options.alpha ?? 1;
  ctx.fillStyle = TIER_COLOR[tier];
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
