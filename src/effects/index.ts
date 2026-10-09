import type { EffectsLayer } from '../contracts/app';
import { TIER_COLOR } from '../game/constants';
import { applyLogicalTransform, fitCanvas } from '../shared/coords';
import { fade, floatOffset, lifeProgress, REDUCED_RING_SECONDS, ringRadius } from './motion';
import { createEffectPool, type EffectPool } from './pool';

// 手順 1 の仮の見本。出来事ごとの強さ・縮む天体などは手順 2 で作る。
const SAMPLE = {
  particles: 14, speed: 160, speedSpread: 220, size: 2, sizeSpread: 3,
  particleSeconds: 0.55, lifetimeSpread: 0.2,
  ringStart: 12, ringEnd: 90, ringWidth: 3, ringSeconds: 0.5,
  fontSize: 24, outlineWidth: 5, textOffset: 22,
};
const TURN = Math.PI * 2;
const pools = new WeakMap<HTMLCanvasElement, EffectPool>();

/** 見本ページの負荷確認用。ゲーム側の受け渡しの型は増やさない。 */
export function inspectEffects(canvas: HTMLCanvasElement) {
  const pool = pools.get(canvas);
  return {
    particles: pool?.particles.reduce((sum, p) => sum + Number(p.active), 0) ?? 0,
    rings: pool?.rings.reduce((sum, p) => sum + Number(p.active), 0) ?? 0,
    texts: pool?.texts.reduce((sum, p) => sum + Number(p.active), 0) ?? 0,
  };
}

/**
 * @param canvas      盤面の上に重ねた透明な Canvas（演出専用）
 * @param shakeTarget 揺らす対象（盤面と演出の Canvas を包む要素）。CSS の transform で揺らす
 */
export function createEffectsLayer(canvas: HTMLCanvasElement, shakeTarget: HTMLElement): EffectsLayer {
  void shakeTarget;
  const ctx = canvas.getContext('2d');
  const pool = createEffectPool();
  pools.set(canvas, pool);
  let reducedMotion = false;
  let outline = '';
  let textColor = '';
  let font = '';

  function readTheme(): void {
    const style = getComputedStyle(canvas);
    outline = style.getPropertyValue('--bg').trim();
    textColor = style.getPropertyValue('--text').trim();
    font = `${SAMPLE.fontSize}px ${style.getPropertyValue('--font').trim() || style.fontFamily}`;
  }

  return {
    resize(cssSize) {
      fitCanvas(canvas, cssSize);
      readTheme();
    },
    handleEvents(events, snapshot) {
      void snapshot;
      for (const event of events) {
        if (event.x === undefined || event.y === undefined) continue;
        const { x, y } = event;
        const color = TIER_COLOR[event.resultTier ?? event.sourceTier ?? 0];
        pool.ring(x, y, SAMPLE.ringStart, SAMPLE.ringEnd, SAMPLE.ringWidth, color,
          reducedMotion ? REDUCED_RING_SECONDS : SAMPLE.ringSeconds, reducedMotion);
        if (!reducedMotion) {
          for (let i = 0; i < SAMPLE.particles; i++) {
            // 版画の火花のように、角度・長さ・太さをばらして均等な放射を避ける。
            const angle = Math.random() * TURN;
            const speed = SAMPLE.speed + Math.random() * SAMPLE.speedSpread;
            if (!pool.particle(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed,
              SAMPLE.size + Math.random() * SAMPLE.sizeSpread, color,
              SAMPLE.particleSeconds + Math.random() * SAMPLE.lifetimeSpread)) break;
          }
        }
        if (event.scoreDelta !== undefined) {
          pool.text(x, y - SAMPLE.textOffset, `＋${event.scoreDelta.toLocaleString('ja-JP')}`, textColor || color);
        }
      }
    },
    update(seconds) { pool.update(seconds); },
    draw() {
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      applyLogicalTransform(ctx);
      ctx.lineCap = 'round';
      for (const ring of pool.rings) {
        if (!ring.active) continue;
        ctx.globalAlpha = fade(ring.age, ring.lifetime);
        ctx.strokeStyle = ring.color;
        ctx.lineWidth = ring.width;
        const radius = ring.stationary ? ring.endRadius : ringRadius(ring.startRadius, ring.endRadius, lifeProgress(ring.age, ring.lifetime));
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, radius, 0, TURN);
        ctx.stroke();
      }
      for (const particle of pool.particles) {
        if (!particle.active) continue;
        ctx.globalAlpha = fade(particle.age, particle.lifetime);
        ctx.fillStyle = particle.color;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, TURN);
        ctx.fill();
      }
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = SAMPLE.outlineWidth;
      ctx.strokeStyle = outline;
      for (const text of pool.texts) {
        if (!text.active) continue;
        ctx.globalAlpha = 1 - lifeProgress(text.age, text.lifetime);
        const y = text.y + floatOffset(text.age);
        ctx.fillStyle = text.color;
        ctx.strokeText(text.text, text.x, y);
        ctx.fillText(text.text, text.x, y);
      }
      ctx.restore();
    },
    // 終了演出は手順 3 で実装する。
    playGameOver() {},
    setReducedMotion(on) {
      reducedMotion = on;
      if (!on) return;
      for (const particle of pool.particles) particle.active = false;
      for (const ring of pool.rings) {
        if (!ring.active) continue;
        ring.startRadius = ring.endRadius;
        ring.stationary = true;
        ring.age = 0;
        ring.lifetime = REDUCED_RING_SECONDS;
      }
    },
    clear() {
      pool.clear();
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    },
  };
}
