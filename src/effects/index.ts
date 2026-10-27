import type { EffectsLayer } from '../contracts/app';
import { applyLogicalTransform, fitCanvas } from '../shared/coords';
import { drawPool } from './draw';
import { createEventEffects } from './events';
import { REDUCED_RING_SECONDS } from './motion';
import { createEffectPool, type EffectPool } from './pool';
import { createPresentation } from './presentation';
import { readTheme } from './theme';
import { createJuiceEffects } from './juice';
import { createCoolingReceipt } from './cooling';

const pools = new WeakMap<HTMLCanvasElement, EffectPool>();
const juiceLayers = new WeakMap<HTMLCanvasElement, ReturnType<typeof createJuiceEffects>>();

/** 見本ページの負荷確認用。ゲーム側の受け渡しの型は増やさない。 */
export function inspectEffects(canvas: HTMLCanvasElement) {
  const pool = pools.get(canvas);
  return {
    particles: pool?.particles.reduce((sum, p) => sum + Number(p.active), 0) ?? 0,
    rings: pool?.rings.reduce((sum, p) => sum + Number(p.active), 0) ?? 0,
    texts: pool?.texts.reduce((sum, p) => sum + Number(p.active), 0) ?? 0,
    bursts: juiceLayers.get(canvas)?.count ?? 0,
    layers: juiceLayers.get(canvas)?.layers ?? 0,
  };
}

/** 盤面の上に重ねる演出。ゲームの状態・物理の進行には触らない。 */
export function createEffectsLayer(canvas: HTMLCanvasElement, shakeTarget: HTMLElement): EffectsLayer {
  const ctx = canvas.getContext('2d');
  const pool = createEffectPool();
  pools.set(canvas, pool);
  const theme = readTheme(canvas);
  const events = createEventEffects(pool, theme);
  const presentation = createPresentation(shakeTarget, theme);
  const juice = createJuiceEffects(shakeTarget, theme);
  const cooling = createCoolingReceipt();
  juiceLayers.set(canvas, juice);

  return {
    resize(cssSize) {
      fitCanvas(canvas, cssSize);
      Object.assign(theme, readTheme(canvas));
    },
    handleEvents(batch, snapshot) {
      juice.sync(snapshot);
      for (const event of batch) {
        cooling.handle(event);
        if (event.kind === 'merge' || event.kind === 'supernova') {
          juice.handle(event, snapshot);
        } else events.handle(event);
      }
    },
    update(seconds) {
      pool.update(seconds);
      events.update(seconds);
      presentation.update(seconds);
      juice.update(seconds);
      cooling.update(seconds);
    },
    draw() {
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      applyLogicalTransform(ctx);
      events.draw(ctx);
      drawPool(ctx, pool, theme);
      juice.draw(ctx);
      presentation.draw(ctx);
      cooling.draw(ctx, theme);
      ctx.restore();
    },
    playGameOver() { presentation.gameOver(); },
    setReducedMotion(on) {
      events.setReduced(on);
      presentation.setReduced(on);
      juice.setReduced(on);
      if (!on) return;
      for (const particle of pool.particles) particle.active = false;
      for (const ring of pool.rings) {
        if (!ring.active) continue;
        ring.stationary = true;
        ring.age = 0;
        ring.lifetime = REDUCED_RING_SECONDS;
      }
    },
    clear() {
      events.clear();
      presentation.clear();
      juice.clear();
      cooling.clear();
      pool.clear();
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    },
    timeScale() { return juice.timeScale(); },
  };
}
