import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPointerInput } from './index';
import { createSimulation } from '../game/simulation';
import type { AimView } from '../contracts/app';
import { DROP_SPEED } from '../game/constants';

afterEach(() => vi.unstubAllGlobals());

function harness() {
  const frames = new Map<number, FrameRequestCallback>(); let next = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++next, callback); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const canvas = new EventTarget() as HTMLCanvasElement;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 960 }) as DOMRect;
  canvas.setPointerCapture = vi.fn();
  const sim = createSimulation(31), aims: (AimView | null)[] = [];
  const predict = vi.fn((command: Parameters<typeof sim.predict>[0]) => sim.predict(command));
  const launch = vi.fn();
  const input = createPointerInput(canvas, { getSnapshot: () => sim.getSnapshot(), predict, onAim: a => aims.push(a), onLaunch: launch });
  input.setEnabled(true);
  const event = (kind: string, x = 480, y = 55) => canvas.dispatchEvent(Object.assign(new Event(kind), { pointerId: 1, button: 0, clientX: x, clientY: y }));
  const frame = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); };
  return { sim, aims, predict, input, event, frame, frames, launch };
}

describe('押さえたままの照準', () => {
  it('指が静止していても盤面が進んだ次の描画で予測を更新し、停止中は再計算しない', () => {
    const h = harness(); h.event('pointerdown');
    expect(h.predict).toHaveBeenCalledTimes(1);
    h.frame(); expect(h.predict).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 60; i++) h.sim.stepFixed();
    h.frame(); expect(h.predict).toHaveBeenCalledTimes(2);
    expect(h.aims.at(-1)?.prediction).toEqual(h.sim.predict({ originAngleRadians: -Math.PI / 2, vx: 0, vy: DROP_SPEED }));
    h.frame(); expect(h.predict).toHaveBeenCalledTimes(2);
    h.input.dispose(); expect(h.frames.size).toBe(0);
  });
  it('指の移動を1描画にまとめ、離す・取り消すと更新を止める', () => {
    const h = harness(); h.event('pointerdown');
    h.event('pointermove', 490, 100); h.event('pointermove', 500, 120);
    expect(h.predict).toHaveBeenCalledTimes(1);
    h.frame(); expect(h.predict).toHaveBeenCalledTimes(2);
    h.event('pointerup', 500, 120); expect(h.launch).toHaveBeenCalledTimes(1);
    expect(h.aims.at(-1)).toBeNull(); expect(h.frames.size).toBe(0);
    h.event('pointerdown'); h.input.setEnabled(false); h.frame();
    expect(h.aims.at(-1)).toBeNull(); expect(h.frames.size).toBe(0);
    h.input.dispose();
  });
});
