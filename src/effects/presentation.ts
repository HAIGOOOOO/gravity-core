import type { Tier } from '../contracts/game';
import { BOARD_SIZE, CORE_RADIUS, GAMEOVER_SECONDS } from '../game/constants';
import { VISUAL } from './appearance';
import { lifeProgress, safeDelta } from './motion';
import type { EffectTheme } from './theme';

const SHAKE_SECONDS = 0.1;
const END_RADIUS = 120;
const END_DIM = 0.6;

export function shakeSize(tier: Tier, nova: boolean): number {
  return nova ? 8 : tier >= 6 ? 4 : tier >= 4 ? 2 : 0;
}

export function endProgress(age: number): number {
  return lifeProgress(age, GAMEOVER_SECONDS);
}

export function createPresentation(target: HTMLElement, theme: EffectTheme) {
  let originalTransform: string | null = null;
  let shakeLeft = 0;
  let shakePower = 0;
  let endingAge = Infinity;
  let reduced = false;

  function restore(): void {
    if (originalTransform !== null) target.style.transform = originalTransform;
    originalTransform = null;
    shakeLeft = 0;
    shakePower = 0;
  }

  return {
    shake(tier: Tier, nova: boolean): void {
      const power = shakeSize(tier, nova);
      if (reduced || power === 0) return;
      // 連打の途中で現在の揺れを基準にすると位置がずれるため、最初の値だけ保存する。
      if (originalTransform === null) originalTransform = target.style.transform;
      shakePower = Math.max(shakePower, power);
      shakeLeft = SHAKE_SECONDS;
    },
    gameOver(): void { endingAge = reduced ? Infinity : 0; },
    update(seconds: number): void {
      const dt = safeDelta(seconds);
      endingAge += dt;
      if (shakeLeft <= 0) return;
      shakeLeft = Math.max(0, shakeLeft - dt);
      if (shakeLeft === 0) { restore(); return; }
      const power = shakePower * (shakeLeft / SHAKE_SECONDS);
      const x = (Math.random() * 2 - 1) * power;
      const y = (Math.random() * 2 - 1) * power;
      target.style.transform = `translate(${x}px, ${y}px) ${originalTransform ?? ''}`.trim();
    },
    draw(ctx: CanvasRenderingContext2D): void {
      if (endingAge >= GAMEOVER_SECONDS) return;
      const p = endProgress(endingAge);
      ctx.save();
      ctx.globalAlpha = END_DIM * p;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(-BOARD_SIZE / 2, -BOARD_SIZE / 2, BOARD_SIZE, BOARD_SIZE);
      ctx.globalAlpha = (1 - p * 0.6) * 0.65;
      const radius = CORE_RADIUS + (END_RADIUS - CORE_RADIUS) * p;
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      glow.addColorStop(0, theme.danger);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, VISUAL.turn);
      ctx.fill();
      ctx.restore();
    },
    setReduced(on: boolean): void {
      reduced = on;
      if (on) { restore(); endingAge = Infinity; }
    },
    clear(): void { restore(); endingAge = Infinity; },
  };
}
