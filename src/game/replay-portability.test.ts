import { expect, it } from 'vitest';
import { dropAt } from '../fixtures';
import { snapshotHash } from '../replay/record';
import { decodePlay, encodeSimulation } from '../share/codec';
import { shareToReplay } from '../share/verify';
import { angleDistance, angleVector } from './angle';
import { LAUNCH_COOLDOWN, TICK_HZ } from './constants';
import { createRng } from './rng';
import { createSimulation } from './simulation';

it('射出の方角を各象限で一周させても、単位の長さと短い角度差を保つ', () => {
  for (let n = -61; n <= 61; n++) {
    const angle = n * .197;
    const basis = angleVector(angle);
    expect(basis.x).toBeCloseTo(Math.cos(angle), 13);
    expect(basis.y).toBeCloseTo(Math.sin(angle), 13);
    expect(basis.x * basis.x + basis.y * basis.y).toBeCloseTo(1, 13);
  }
  expect(angleDistance(-.1, 2 * Math.PI - .2)).toBeCloseTo(.1, 13);
});

it('実行環境間で照合した187投の最終盤面を、共有から再現する', () => {
  const sim = createSimulation(1);
  const random = createRng(102);
  const interval = Math.round(LAUNCH_COOLDOWN * TICK_HZ);
  for (let tick = 0; tick < 11_161; tick++) {
    if (tick % interval === 0) sim.submitLaunch(dropAt(random() * Math.PI * 2));
    sim.stepFixed();
  }
  const packed = encodeSimulation(sim);
  const decoded = decodePlay(packed);
  expect(decoded).toMatchObject({ ok: true, play: { rulesVersion: 'r13.c3152231', endTick: 11_161 } });
  if (decoded.ok) expect(decoded.play.inputs).toHaveLength(187);
  const shared = shareToReplay(packed);
  expect(shared).toMatchObject({ ok: true, final: { tick: 11_161, score: 290_200 } });
  if (shared.ok) {
    expect(shared.final.bodies).toHaveLength(40);
    expect(snapshotHash(shared.final)).toBe('a06aed64');
    expect(shared.final).toEqual(sim.getSnapshot());
  }
});
