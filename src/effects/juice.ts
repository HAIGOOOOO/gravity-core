import type { GameEvent, GameSnapshot } from '../contracts/game';
import { LIMIT_RADIUS, TIER_RADIUS } from '../game/constants';
import { createJuiceInk } from './juice-ink';
import { drawLocalLayer } from './juice-local';
import { drawWideLayer } from './juice-wide';
import { blankBurst, burstFromEvent, burstLife, JUICE_CAP, juiceRandom, juiceTimeScale, layerCount, LAYER_ENDS, pulse, visualAge } from './juice-model';
import type { EffectTheme } from './theme';
import { createChainOrigins } from './juice-chain';

// 空間→物体→破片→数字。文字を光と煙の下へ埋めない。
const DRAW_ORDER = [28, 29, 33, 34, 38, 41, 3, 2, 1, 4, 5, 7, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 22,
  23, 25, 26, 27, 30, 31, 32, 35, 36, 37, 39, 42];

export function createJuiceEffects(target: HTMLElement, theme: EffectTheme) {
  const bursts = Array.from({ length: JUICE_CAP }, blankBurst);
  const ink = createJuiceInk(theme);
  let reduced = false, original: string | null = null;
  const origins = createChainOrigins();
  const restore = () => { if (original !== null) target.style.transform = original; original = null; };
  return {
    get count(): number { return bursts.filter(b => b.active).length; },
    get layers(): number { return bursts.reduce((n, b) => b.active ? Math.max(n, layerCount(b.chain, b.nova)) : n, 0); },
    handle(event: GameEvent, snapshot: GameSnapshot): void {
      if (event.kind !== 'merge' && event.kind !== 'supernova') return;
      // 固定枠が埋まったら古い余韻を譲り、新しい出来事の瞬間を残す。
      const slot = bursts.find(b => !b.active) ?? bursts.reduce((a, b) => a.age > b.age ? a : b);
      Object.assign(slot, burstFromEvent(event, origins.receive(event)));
      slot.resultBody = snapshot.bodies.find(body => body.id === slot.resultId) ?? null;
      slot.neighbors = snapshot.bodies.filter(body => !event.bodyIds?.includes(body.id)).slice(0, 16);
      if (original === null && !reduced) original = target.style.transform;
    },
    sync(snapshot: GameSnapshot): void {
      for (const b of bursts) if (b.active && b.resultId !== null) b.resultBody = snapshot.bodies.find(body => body.id === b.resultId) ?? null;
    },
    update(seconds: number): void {
      const dt = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
      let power = 0, x = 0, y = 0, angle = 0, zoom = 0;
      for (const b of bursts) {
        if (!b.active) continue;
        b.age += dt;
        if (b.age >= (reduced ? 0.55 : burstLife(b))) { b.active = false; continue; }
        if (reduced) continue;
        const strength = (b.nova ? 1 : b.chain >= 5 ? 0.9 : b.chain >= 3 || b.tier >= 3 ? 0.5 : 0);
        const envelope = pulse(visualAge(b), 0.065, 0.24) * strength;
        if (envelope > power) {
          power = envelope; const a = juiceRandom(b.seed, 3) * Math.PI * 2;
          x = Math.cos(a) * envelope * Math.cos(b.age * 54); y = Math.sin(a) * envelope * Math.cos(b.age * 47);
          angle = Math.sin(b.age * 43) * envelope * 0.55; zoom = envelope * 0.03;
        }
      }
      if (reduced || !bursts.some(b => b.active)) { restore(); return; }
      const size = target.clientWidth || 480;
      target.style.transform = `translate(${x * size * 0.012}px,${y * size * 0.012}px) rotate(${angle}deg) scale(${1 + zoom}) ${original ?? ''}`.trim();
    },
    draw(ctx: CanvasRenderingContext2D): void {
      ctx.save();
      // 外の照準と限界リングは演出で塗らず、強い光も局所に閉じ込める。
      const heroes = bursts.filter(b => b.active).sort((a, b) => Math.abs(a.age - 0.2) - Math.abs(b.age - 0.2)).slice(0, 2);
      for (const b of bursts) {
        if (!b.active) continue;
        if (reduced) {
          ctx.save(); ctx.translate(b.x, b.y); ctx.globalAlpha = 1 - b.age / 0.55;
          ctx.strokeStyle = theme.chain; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 35 + b.result * 6, 0, Math.PI * 2); ctx.stroke();
          ctx.font = `800 28px ${theme.font}`; ctx.fillStyle = theme.text; ctx.textAlign = 'center'; ctx.fillText(`+${b.score}`, 0, -45); ctx.restore(); continue;
        }
        // 広い空間の層は同時2件まで。残りも局所22層で反応を残す。
        const count = Math.min(heroes.includes(b) ? 42 : 22, layerCount(b.chain, b.nova));
        const age = visualAge(b);
        const drawSet = (ids: readonly number[]) => {
          for (const id of ids) {
            if (id > count || age > LAYER_ENDS[id - 1]) continue;
            ctx.save(); if (id <= 22) drawLocalLayer(id, ctx, b, ink); else drawWideLayer(id, ctx, b, ink); ctx.restore();
          }
        };
        ctx.save();
        ctx.beginPath(); ctx.arc(0, 0, LIMIT_RADIUS - 12, 0, Math.PI * 2); ctx.clip();
        // 何十層にも同じクリップを作らず、背後の層を一度に保護する。
        if (b.resultBody && age >= 0.08 && age <= 0.6) {
          const body = b.resultBody, hole = body.radius + 10;
          ctx.beginPath(); ctx.rect(-LIMIT_RADIUS, -LIMIT_RADIUS, LIMIT_RADIUS * 2, LIMIT_RADIUS * 2);
          ctx.moveTo(body.x + hole, body.y); ctx.arc(body.x, body.y, hole, 0, Math.PI * 2); ctx.clip('evenodd');
        }
        ctx.translate(b.x, b.y); drawSet(DRAW_ORDER); ctx.restore();
        ctx.save(); ctx.beginPath(); ctx.arc(0, 0, LIMIT_RADIUS - 12, 0, Math.PI * 2); ctx.clip();
        ctx.translate(b.x, b.y); drawSet([17, 18]); ctx.restore();
        ctx.save(); ctx.translate(b.x, b.y); drawSet([19, 20, 21, 24, 40]); ctx.restore();
      }
      ctx.restore();
    },
    timeScale(): number { return bursts.reduce((scale, b) => Math.min(scale, juiceTimeScale(b, reduced)), 1); },
    setReduced(on: boolean): void { reduced = on; if (on) restore(); },
    clear(): void { bursts.forEach(b => { b.active = false; }); origins.clear(); restore(); },
  };
}
