import { describe, expect, it } from 'vitest';
import type { BodyView, GameSnapshot, Prediction } from '../contracts/game';
import { DROP_SPEED, TICK_HZ } from '../game/constants';
import { playOnce, summarizeRuns } from './batch';
import {
  ALL_BOTS,
  curveBot,
  isSafeLanding,
  mergeBot,
  randomBot,
  safeMergeBot,
  spiralBot,
  type PredictFn,
} from './bots';

const SHORT = 20 * TICK_HZ;
const MEDIUM = 60 * TICK_HZ;

describe('ボットの決定性', () => {
  for (const make of ALL_BOTS) {
    const name = make(0).name;
    it(
      `${name}: 同じシードで 2 回遊ぶと全く同じ結果になる`,
      () => {
        const a = playOnce(make(7), { seed: 7, maxTicks: SHORT });
        const b = playOnce(make(7), { seed: 7, maxTicks: SHORT });
        expect(a.result).toEqual(b.result);
        // 撃った記録まで一致する＝途中の判断も全て同じ
        expect(a.sim.getInputLog()).toEqual(b.sim.getInputLog());
      },
      30_000,
    );
  }
});

describe('ボットの強さ', () => {
  it(
    '狙って合体させるボットは、無作為より平均の合体数が多い',
    () => {
      const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
      const mergeRuns = seeds.map((s) => playOnce(mergeBot(s), { seed: s, maxTicks: MEDIUM }).result);
      const randomRuns = seeds.map((s) => playOnce(randomBot(s), { seed: s, maxTicks: MEDIUM }).result);
      const smart = summarizeRuns(mergeRuns).merges.mean;
      const naive = summarizeRuns(randomRuns).merges.mean;
      expect(smart).toBeGreaterThan(naive);
    },
    60_000,
  );
});

// ---------------------------------------------------------------------------
// decide の中身を、予測関数を差し替えて確かめる。
// 実シミュレーションを回さないので速く、「合体できる方角が 1 つだけある」等の
// 狙った状況を確実に作れる。

/** merge / merge-safe の方角の刻み（bots.ts の STRAIGHT_ANGLES と同じ 48 等分） */
const GRID48 = (Math.PI * 2) / 48;

function snap(over: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    tick: 0,
    phase: 'active',
    bodies: [],
    heat: 0,
    overLimit: false,
    score: 0,
    bestTierThisRun: 0,
    nextQueue: [0, 0, 0],
    launchCooldownLeftSeconds: 0,
    seed: 1,
    stats: { launches: 0, merges: 0, supernovas: 0, maxChain: 0 },
    ...over,
  };
}

function pred(over: Partial<Prediction> = {}): Prediction {
  return { valid: true, points: [], end: 'timeLimit', hitBodyId: null, willMerge: false, ...over };
}

function body(over: Partial<BodyView> = {}): BodyView {
  return {
    id: 1,
    tier: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: 14,
    bornTick: 0,
    chain: 0,
    chainUntilTick: 0,
    overLimit: false,
    ...over,
  };
}

/** 「このボットは予測を呼ばない」ことを確かめるための、呼ばれたら落ちる予測 */
const neverPredict: PredictFn = () => {
  throw new Error('このボットは予測を呼ばないはず');
};

describe('狙いを定める判断（予測を差し替える）', () => {
  it('merge: 合体できると予測された方角を選ぶ', () => {
    const target = 9 * GRID48;
    const predict: PredictFn = (c) =>
      pred({ end: 'core', willMerge: Math.abs(c.originAngleRadians - target) < 1e-9 });
    expect(mergeBot(1).decide(snap(), predict).originAngleRadians).toBeCloseTo(target, 9);
  });

  it('merge は危ない天体へ寄せ、merge-safe は安全な方角へ変える', () => {
    const risky = 3 * GRID48;
    const safe = 7 * GRID48;
    const predict: PredictFn = (c) => {
      if (Math.abs(c.originAngleRadians - risky) < 1e-9) {
        // 中心から 400 の所で天体に当たる。着地点 + 半径 14 がリング（320）を越える
        return pred({ end: 'body', points: [{ x: 400, y: 0, t: 1 }], hitBodyId: 1 });
      }
      if (Math.abs(c.originAngleRadians - safe) < 1e-9) return pred({ end: 'core' });
      return pred({ valid: false });
    };
    expect(mergeBot(1).decide(snap(), predict).originAngleRadians).toBeCloseTo(risky, 9);
    expect(safeMergeBot(1).decide(snap(), predict).originAngleRadians).toBeCloseTo(safe, 9);
  });

  it('全部の方角が invalid なら、刻みの上の直投げに倒れる', () => {
    const cmd = mergeBot(1).decide(snap(), () => pred({ valid: false }));
    const k = cmd.originAngleRadians / GRID48;
    expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
    expect(Math.hypot(cmd.vx, cmd.vy)).toBeCloseTo(DROP_SPEED, 9);
    const outward = cmd.vx * Math.cos(cmd.originAngleRadians) + cmd.vy * Math.sin(cmd.originAngleRadians);
    expect(outward).toBeCloseTo(-DROP_SPEED, 9);
  });

  it('curve: 曲げた射出でしか合体できない時は、曲げた射出を選ぶ', () => {
    const predict: PredictFn = (c) =>
      pred({ end: 'core', willMerge: Math.hypot(c.vx, c.vy) > DROP_SPEED + 1 });
    const cmd = curveBot(1).decide(snap(), predict);
    expect(Math.hypot(cmd.vx, cmd.vy)).toBeGreaterThan(DROP_SPEED + 1);
  });
});

describe('isSafeLanding（着地先の安全判定）', () => {
  const R = 14; // Tier 0 の半径
  it('核に着くなら安全', () => {
    expect(isSafeLanding(pred({ end: 'core' }), snap(), R)).toBe(true);
  });
  it('行き先不明（timeLimit）は危ない側に数える', () => {
    expect(isSafeLanding(pred({ end: 'timeLimit' }), snap(), R)).toBe(false);
  });
  it('着地点の外側がリング内なら安全、越えれば危ない', () => {
    expect(isSafeLanding(pred({ end: 'body', points: [{ x: 200, y: 0, t: 1 }] }), snap(), R)).toBe(true);
    expect(isSafeLanding(pred({ end: 'body', points: [{ x: 400, y: 0, t: 1 }] }), snap(), R)).toBe(false);
  });
  it('ちょうどリング上は「越えていない」（シミュレーション側と同じく「より外」だけ）', () => {
    // 306 + 14 = 320 = LIMIT_RADIUS ちょうど
    expect(isSafeLanding(pred({ end: 'body', points: [{ x: 306, y: 0, t: 1 }] }), snap(), R)).toBe(true);
  });
  it('当たる天体がすでに限界越え（overLimit）なら危ない', () => {
    const s = snap({ bodies: [body({ id: 9, overLimit: true })] });
    expect(isSafeLanding(pred({ end: 'body', points: [{ x: 200, y: 0, t: 1 }], hitBodyId: 9 }), s, R)).toBe(false);
  });
  it('points が空でも落ちない', () => {
    expect(isSafeLanding(pred({ end: 'body', hitBodyId: 1 }), snap(), R)).toBe(true);
  });
});

describe('予測を使わないボット', () => {
  it('random / spiral は予測を呼ばない', () => {
    randomBot(1).decide(snap(), neverPredict);
    spiralBot(1).decide(snap(), neverPredict);
  });
  it('random / spiral はシードが違えば最初の方角も違う', () => {
    const r1 = randomBot(1).decide(snap(), neverPredict).originAngleRadians;
    const r2 = randomBot(2).decide(snap(), neverPredict).originAngleRadians;
    expect(Math.abs(r1 - r2)).toBeGreaterThan(1e-6);
    const s1 = spiralBot(1).decide(snap(), neverPredict).originAngleRadians;
    const s2 = spiralBot(2).decide(snap(), neverPredict).originAngleRadians;
    expect(Math.abs(s1 - s2)).toBeGreaterThan(1e-6);
  });
  it('spiral は盤面を見ない（同じシードなら盤面が違っても同じ射出）', () => {
    const a = spiralBot(5).decide(snap(), neverPredict);
    const b = spiralBot(5).decide(snap({ bodies: [body({ overLimit: true })] }), neverPredict);
    expect(b).toEqual(a);
  });
});
