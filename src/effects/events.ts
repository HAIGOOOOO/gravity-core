import type { GameEvent, Tier } from '../contracts/game';
import { LIMIT_RADIUS, TIER_COLOR, TIER_RADIUS } from '../game/constants';
import { drawBody } from '../render/bodies';
import { EFFECT_TEXT, impactStrength, mergeProfile, signedNumber, VISUAL } from './appearance';
import { fade, lifeProgress, REDUCED_RING_SECONDS, safeDelta } from './motion';
import { RING_CAP, type EffectPool } from './pool';
import type { EffectTheme } from './theme';

type Fusion = {
  active: boolean; age: number; emitted: boolean; x: number; y: number;
  source: Tier; result: Tier; score: number | undefined; heat: number | undefined;
  chain: number; nova: boolean;
};

export function createEventEffects(pool: EffectPool, theme: EffectTheme) {
  const fusions: Fusion[] = Array.from({ length: RING_CAP }, () => ({
    active: false, age: 0, emitted: false, x: 0, y: 0, source: 0, result: 0,
    score: undefined, heat: undefined, chain: 1, nova: false,
  }));
  let reduced = false;
  let limitAge = Infinity;
  let recovering = false;

  function ring(x: number, y: number, start: number, end: number, width: number, color: string, seconds: number): void {
    pool.ring(x, y, start, end, width, color, reduced ? REDUCED_RING_SECONDS : seconds, reduced);
  }

  function sparks(x: number, y: number, count: number, speed: number, color: string, seconds: number): void {
    if (reduced) return;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * VISUAL.turn;
      const velocity = speed * (0.35 + Math.random() * 0.65);
      if (!pool.particle(x, y, Math.cos(angle) * velocity, Math.sin(angle) * velocity,
        VISUAL.particleSize + Math.random() * VISUAL.particleSizeSpread, color,
        seconds * (0.7 + Math.random() * 0.3))) break;
    }
  }

  function burst(fusion: Fusion): void {
    const p = mergeProfile(fusion.result, fusion.chain, fusion.nova);
    const color = fusion.chain > 1 ? theme.chain : TIER_COLOR[fusion.result];
    for (let i = 0; i < p.rings; i++) {
      ring(fusion.x, fusion.y, TIER_RADIUS[fusion.result] * 0.7,
        p.radius * (1 - i * 0.14), p.width / (1 + i),
        i === 0 ? theme.text : color, p.seconds * (1 - i * 0.1));
    }
    sparks(fusion.x, fusion.y, p.particles, p.speed, color, p.particleSeconds);
    if (fusion.score !== undefined) {
      const label = `${fusion.nova ? `${EFFECT_TEXT.nova} ` : ''}${signedNumber(fusion.score)}`;
      pool.text(fusion.x, fusion.y - TIER_RADIUS[fusion.result] - VISUAL.textGap,
        label, theme.text, fusion.nova ? VISUAL.novaTextSize : VISUAL.textSize);
    }
    if (fusion.chain > 1 && !fusion.nova) {
      pool.text(fusion.x, fusion.y - TIER_RADIUS[fusion.result] - VISUAL.textGap * 2,
        `${EFFECT_TEXT.chain} ×${fusion.chain}`, theme.chain, VISUAL.chainTextSize);
    }
    if (fusion.nova && fusion.heat !== undefined) {
      pool.text(fusion.x, fusion.y + VISUAL.textGap,
        `${EFFECT_TEXT.heat} ${signedNumber(fusion.heat)}`, theme.cool, VISUAL.textSize);
    }
  }

  return {
    handle(event: GameEvent): void {
      if (event.kind === 'overLimitStart' || event.kind === 'overLimitEnd') {
        limitAge = 0;
        recovering = event.kind === 'overLimitEnd';
        return;
      }
      if (event.x === undefined || event.y === undefined) return;
      const { x, y } = event;
      const source = event.sourceTier ?? 0;
      const color = TIER_COLOR[source];
      switch (event.kind) {
        case 'launch':
          ring(x, y, TIER_RADIUS[source], TIER_RADIUS[source] + VISUAL.launchSpread, 5, color, VISUAL.launchSeconds);
          break;
        case 'land': {
          const strength = impactStrength(event.impactSpeed ?? 0);
          ring(x, y, 4, 18 + strength * 34, 2 + strength * 3, color, 0.18 + strength * 0.08);
          sparks(x, y, Math.round(5 + strength * 15), 150 + strength * 350, color, 0.25);
          break;
        }
        case 'merge':
        case 'supernova': {
          const slot = fusions.find((f) => !f.active);
          if (!slot) break;
          slot.active = true; slot.age = 0; slot.emitted = false;
          slot.x = x; slot.y = y; slot.source = source;
          slot.result = event.resultTier ?? source;
          slot.score = event.scoreDelta; slot.heat = event.heatDelta;
          slot.chain = event.chain ?? 1; slot.nova = event.kind === 'supernova';
          if (reduced) { burst(slot); slot.active = false; }
          break;
        }
      }
    },
    update(seconds: number): void {
      const dt = safeDelta(seconds);
      limitAge += dt;
      for (const fusion of fusions) {
        if (!fusion.active) continue;
        fusion.age += dt;
        const delay = fusion.nova ? VISUAL.novaShrinkSeconds : VISUAL.shrinkSeconds;
        if (!fusion.emitted && fusion.age >= delay) {
          burst(fusion);
          fusion.emitted = true;
        }
        if (fusion.age >= delay + VISUAL.flashSeconds) fusion.active = false;
      }
    },
    draw(ctx: CanvasRenderingContext2D): void {
      const seconds = recovering ? VISUAL.recoverySeconds : VISUAL.warningSeconds;
      if (limitAge < seconds) {
        ctx.save();
        ctx.globalAlpha = fade(limitAge, seconds);
        ctx.strokeStyle = recovering ? theme.cool : theme.danger;
        const angle = reduced ? 0 : limitAge * 8;
        ctx.lineWidth = recovering ? 3 : 9;
        ctx.beginPath();
        ctx.arc(0, 0, LIMIT_RADIUS, angle, angle + Math.PI * (recovering || reduced ? 2 : 0.8));
        ctx.stroke();
        if (!recovering && !reduced) {
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, 0, LIMIT_RADIUS, angle + Math.PI, angle + Math.PI * 1.45);
          ctx.stroke();
        }
        ctx.restore();
      }
      for (const fusion of fusions) {
        if (!fusion.active) continue;
        const delay = fusion.nova ? VISUAL.novaShrinkSeconds : VISUAL.shrinkSeconds;
        const sourceRadius = TIER_RADIUS[fusion.source];
        ctx.save();
        if (fusion.age < delay) {
          const remaining = 1 - lifeProgress(fusion.age, delay);
          ctx.globalAlpha = remaining;
          drawBody(ctx, fusion.source, fusion.x - sourceRadius * remaining, fusion.y - sourceRadius * remaining * 0.3, sourceRadius * remaining);
          drawBody(ctx, fusion.source, fusion.x + sourceRadius * remaining, fusion.y + sourceRadius * remaining * 0.3, sourceRadius * remaining);
        } else {
          const p = lifeProgress(fusion.age - delay, VISUAL.flashSeconds);
          const radius = TIER_RADIUS[fusion.result] * (fusion.nova ? 1.6 : 0.6 + p * 0.4);
          if (!fusion.nova) drawBody(ctx, fusion.result, fusion.x, fusion.y, radius);
          ctx.globalAlpha = (1 - p) * 0.85;
          ctx.fillStyle = theme.text;
          ctx.beginPath();
          ctx.arc(fusion.x, fusion.y, radius, 0, VISUAL.turn);
          ctx.fill();
          ctx.strokeStyle = fusion.chain > 1 ? theme.chain : TIER_COLOR[fusion.result];
          ctx.lineWidth = 12 * (1 - p);
          ctx.beginPath();
          ctx.arc(fusion.x, fusion.y, radius * 1.15, 0, VISUAL.turn);
          ctx.stroke();
        }
        ctx.restore();
      }
    },
    setReduced(on: boolean): void {
      reduced = on;
      if (!on) return;
      for (const fusion of fusions) {
        if (!fusion.active) continue;
        if (!fusion.emitted) burst(fusion);
        fusion.active = false;
      }
    },
    clear(): void {
      for (const fusion of fusions) fusion.active = false;
      limitAge = Infinity;
    },
  };
}
