import type { Tier } from '../contracts/game';
import { TIER_NAMES } from '../game/constants';
import { drawBody } from '../render/bodies';

const ICON_PIXELS = 128;
const ICON_RADIUS = 42;
export function bodyIcon(tier: Tier): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ICON_PIXELS;
  canvas.className = 'body-icon';
  paintBodyIcon(canvas, tier);
  return canvas;
}

export function paintBodyIcon(canvas: HTMLCanvasElement, tier: Tier): void {
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', TIER_NAMES[tier]);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, ICON_PIXELS, ICON_PIXELS);
  drawBody(ctx, tier, ICON_PIXELS / 2, ICON_PIXELS / 2, ICON_RADIUS, { seed: tier });
}
