import { afterEach, expect, it, vi } from 'vitest';
import { createEffectsLayer, inspectEffects } from './index';
import { createSimulation } from '../game/simulation';

afterEach(() => vi.unstubAllGlobals());

it('本体が使う入口から停止とスローを渡し、合体を二重に発生させない', () => {
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '', fontFamily: 'sans-serif' }));
  const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
  const target = { style: { transform: '' } } as unknown as HTMLElement;
  const effects = createEffectsLayer(canvas, target);
  effects.handleEvents([{ kind: 'merge', tick: 1, sequence: 1, x: 0, y: 0,
    sourceTier: 4, resultTier: 5, chain: 5, scoreDelta: 2700, heatDelta: -14 }], createSimulation(1).getSnapshot());
  effects.update(.1);
  expect(effects.timeScale?.()).toBe(0);
  expect(inspectEffects(canvas)).toEqual({ particles: 0, rings: 0, texts: 0 });
  effects.update(.1);
  expect(effects.timeScale?.()).toBe(.3);
  effects.setReducedMotion(true);
  expect(effects.timeScale?.()).toBe(1);
  expect(target.style.transform).toBe('');
  effects.clear();
  expect(effects.timeScale?.()).toBe(1);
});
