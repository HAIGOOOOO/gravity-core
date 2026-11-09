import { describe, expect, it } from 'vitest';
import type { LaunchInput } from '../contracts/game';
import { TICK_HZ } from '../game/constants';
import { quantizeLaunch } from '../game/predictor';
import { createSimulation } from '../game/simulation';
import { aimVelocity } from '../shared/launch';
import { createReplayPlayer } from '../replay/player';
import { createReplayRecord } from '../replay/record';
import { rulesVersion } from '../replay/rules';
import { MAX_REPLAY_TICKS } from '../replay/limits';
import { decodePlay, encodePlay, encodeReplayShare, encodeSimulation, shareToReplay } from './index';

describe('再生の共有', () => {
  it('共有元の得点を採用せず、終点の射出も含めて最終盤面を再現する', () => {
    const sim = createSimulation(7);
    const angle = -Math.PI / 2;
    const command = { originAngleRadians: angle, ...aimVelocity(angle, 0, 0) };
    expect(sim.submitLaunch(command).accepted).toBe(true);
    for (let i = 0; i < 300; i++) sim.stepFixed();
    expect(sim.submitLaunch(command).accepted).toBe(true);
    const original = createReplayRecord(sim);
    expect(original.finalScore).toBeGreaterThan(0);
    const code = encodeReplayShare({ ...original, finalScore: 99999999 });
    expect(code).toBe(encodeSimulation(sim));
    expect(decodePlay(code)).toMatchObject({ ok: true, play: { rulesVersion: rulesVersion() } });
    const shared = shareToReplay(code);
    expect(shared.ok).toBe(true);
    if (!shared.ok) return;
    expect(shared.final).toEqual(sim.getSnapshot());
    expect(shared.record).toMatchObject({ finalHash: original.finalHash, finalScore: original.finalScore });
    const player = createReplayPlayer(shared.record);
    expect(player.ok).toBe(true);
    if (player.ok) expect(player.player.seek(original.endTick)).toEqual(shared.final);
  });

  it('数値の旧ルールと別指紋は、共有からの再生を許さない', () => {
    for (const version of [2, 'r999.ffffffff']) {
      const text = encodePlay({ rulesVersion: version, seed: 7, inputs: [] });
      expect(decodePlay(text).ok).toBe(true);
      expect(shareToReplay(text)).toEqual({ ok: false, reason: 'rulesMismatch' });
    }
  });

  it('受理されない射出、充填済み射出、時間上限を越える記録を弾く', () => {
    const base = { rulesVersion: rulesVersion(), seed: 7, endTick: 10 };
    const input = { tick: 0, originAngleRadians: 0, vx: 620, vy: 0 };
    const text = encodePlay({ ...base, inputs: [input] });
    expect(shareToReplay(text)).toEqual({ ok: false, reason: 'invalidRun' });
    expect(encodePlay({ ...base, inputs: [{ ...input, charged: true }] })).toBe('');
    expect(encodePlay({ ...base, endTick: MAX_REPLAY_TICKS, inputs: [] })).not.toBe('');
    expect(encodePlay({ ...base, endTick: MAX_REPLAY_TICKS + 1, inputs: [] })).toBe('');
  });

  it('実際の照準変換で作った3分152投のドラッグを、2,000字以内で可逆に収める', () => {
    const endTick = 3 * 60 * TICK_HZ;
    const inputs: LaunchInput[] = Array.from({ length: 152 }, (_, index) => {
      const angle = -Math.PI + index * 0.137;
      const dragAngle = angle + Math.PI + (index % 7 - 3) * 0.12;
      const drag = 70 + index % 115;
      return { tick: Math.floor(endTick * index / 152),
        ...quantizeLaunch({ originAngleRadians: angle,
          ...aimVelocity(angle, drag * Math.cos(dragAngle), drag * Math.sin(dragAngle)) }) };
    });
    const text = encodePlay({ rulesVersion: rulesVersion(), seed: 7, endTick, inputs });
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(decodePlay(text)).toEqual({ ok: true, play: { rulesVersion: rulesVersion(), seed: 7, endTick, inputs } });
  });
});
