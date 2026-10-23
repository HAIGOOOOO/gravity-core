import { describe, expect, it } from 'vitest';
import { LAUNCH_COOLDOWN, TICK_HZ } from '../game/constants';
import { quantizeLaunch } from '../game/predictor';
import { createSimulation } from '../game/simulation';
import { aimVelocity } from '../shared/launch';
import { createReplayRecord, parseReplay, serializeReplay } from './record';
import { createReplayPlayer } from './player';
import { MAX_REPLAY_TEXT_LENGTH } from './serialization';
import { recordAutoPlay } from './testkit';

describe('端末保存の可逆圧縮', () => {
  it('旧JSONを読み、圧縮して読み戻しても入力・指紋と再生結果が変わらない', () => {
    const { record } = recordAutoPlay(7, 1800);
    const legacy = parseReplay(JSON.stringify(record));
    expect(legacy).toEqual(record);
    const text = serializeReplay(legacy!);
    expect(text.length).toBeLessThan(JSON.stringify(record).length);
    const restored = parseReplay(text);
    expect(restored).toEqual(record);
    expect(serializeReplay(restored!)).toBe(text);
    const start = createReplayPlayer(restored!);
    expect(start.ok).toBe(true);
    if (start.ok) expect(start.player.seek(record.endTick).score).toBe(record.finalScore);
  });

  it('10分間に撃てる最大数の投げ操作でも保存が20KB以内', () => {
    const endTick = 10 * 60 * TICK_HZ;
    const spacing = Math.round(LAUNCH_COOLDOWN * TICK_HZ);
    // 実際の操作変換とゲーム側の丸めを使用。容量の上限を調べる入力であり、
    // この1200投を本物の盤面が10分間すべて受け付けた、という主張はしない。
    const inputs = Array.from({ length: endTick / spacing }, (_, i) => {
      const angle = i * .73;
      const velocity = aimVelocity(angle, -120 * Math.cos(angle - .35), -120 * Math.sin(angle - .35));
      return { tick: i * spacing, ...quantizeLaunch({ originAngleRadians: angle, ...velocity }) };
    });
    const record = { ...createReplayRecord(createSimulation(7)), endTick, inputs };
    const text = serializeReplay(record);
    const bytes = new TextEncoder().encode(text).length;
    expect(text).not.toBe('');
    expect(parseReplay(text)?.inputs.map(({ tick, originAngleRadians, vx, vy }) => ({ tick, originAngleRadians, vx, vy })))
      .toEqual(inputs.map(({ tick, originAngleRadians, vx, vy }) => ({ tick, originAngleRadians, vx, vy })));
    expect(bytes).toBeLessThanOrEqual(20 * 1024);
    console.log(`[replay-storage] 10min capacity: ${inputs.length} throws, ${bytes}B (old JSON ${JSON.stringify(record).length}B)`);
  });

  it('圧縮入力の破損・外側との食い違い・未対応の保存版は読み込まない', () => {
    const record = createReplayRecord(createSimulation(1));
    const packed = JSON.parse(serializeReplay(record));
    for (const value of [
      { ...packed, inputs: packed.inputs.slice(0, -1) },
      { ...packed, seed: packed.seed + 1 },
      { ...packed, endTick: packed.endTick + 1 },
      { ...packed, packing: 2 },
    ]) expect(parseReplay(JSON.stringify(value))).toBeNull();
  });

  it('読み込みの長さ・入力順・未対応操作に上限を設ける', () => {
    const record = createReplayRecord(createSimulation(1));
    expect(parseReplay(' '.repeat(MAX_REPLAY_TEXT_LENGTH + 1))).toBeNull();
    const input = { tick: 0, originAngleRadians: 0, vx: -260, vy: 0 };
    expect(parseReplay(JSON.stringify({ ...record, inputs: [input, { ...input, tick: -1 }] }))).toBeNull();
    expect(parseReplay(JSON.stringify({ ...record, inputs: [{ ...input, tick: 1 }] }))).toBeNull();
    expect(serializeReplay({ ...record, inputs: [{ ...input, charged: true }] })).toBe('');
  });
});
