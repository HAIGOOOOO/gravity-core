import type { GameEvent } from '../contracts/game';
import { STRINGS } from '../ui/strings';
import type { EffectTheme } from './theme';

const JOIN_SECONDS = 0.18, HOLD_SECONDS = 1.4, FADE_SECONDS = 0.2;

/** 同時の合体は一枚へまとめる。冷却量を推測せず実際の差分だけを表示する。 */
export function createCoolingReceipt() {
  let amount = 0, age = Infinity, lastSequence = -1;
  return {
    handle(event: GameEvent): void {
      if (event.kind !== 'merge' && event.kind !== 'supernova') return;
      if (event.sequence <= lastSequence) return;
      lastSequence = event.sequence;
      const delta = event.heatDelta ?? 0;
      if (!Number.isFinite(delta) || delta >= 0) return;
      amount = (age <= JOIN_SECONDS ? amount : 0) - delta;
      age = 0;
    },
    update(seconds: number): void { if (Number.isFinite(seconds)) age += Math.max(0, seconds); },
    get value(): number { return age < HOLD_SECONDS ? amount : 0; },
    draw(ctx: CanvasRenderingContext2D, theme: EffectTheme): void {
      if (age >= HOLD_SECONDS) return;
      ctx.save(); ctx.globalAlpha = Math.min(1, (HOLD_SECONDS - age) / FADE_SECONDS);
      ctx.font = `700 30px ${theme.font}`; ctx.textAlign = 'center';
      const text = `${STRINGS.effectHeat} −${Number(amount.toFixed(1))}`;
      const width = ctx.measureText(text).width + 32;
      ctx.fillStyle = '#101b1a'; ctx.fillRect(-width / 2, -442, width, 42);
      ctx.strokeStyle = '#b2e6bc'; ctx.lineWidth = 2; ctx.strokeRect(-width / 2, -442, width, 42);
      ctx.fillStyle = '#c5f4cb'; ctx.fillText(text, 0, -410); ctx.restore();
    },
    clear(): void { amount = 0; age = Infinity; lastSequence = -1; },
  };
}
