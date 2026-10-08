// 見本データ（リーダー担当）。各担当の見本ページ（dev/*.html）とテストで使う。
// 本物の計算（src/game/）で作っているので、数値は本番と同じ形になる。

import type { ResultView, RunRecord } from '../contracts/app';
import type { GameEvent, GameEventKind, LaunchCommand, SimulationPort, Tier } from '../contracts/game';
import { LAUNCH_RADIUS, SPEED_MAX, SPEED_MIN, TIER_BASE_SCORE } from '../game/constants';
import { circularSpeed, clockwiseTangent } from '../game/physics';
import { createRng } from '../game/rng';
import { createSimulation, type SimulationSetup } from '../game/simulation';

type SetupBody = NonNullable<SimulationSetup['bodies']>[number];

/** 半径 r・角度 angle の円軌道を時計回りに回る天体。 */
export function orbiting(tier: Tier, r: number, angle: number): SetupBody {
  const t = clockwiseTangent(angle);
  const v = circularSpeed(r);
  return { tier, x: r * Math.cos(angle), y: r * Math.sin(angle), vx: t.x * v, vy: t.y * v };
}

/** Tier 0〜8 が 1 体ずつ、ぶつからない軌道を回っている盤面。 */
export function setupAllTiers(heat = 15): SimulationSetup {
  // 同じ輪の上の天体は同じ速さで回るので、ずっとぶつからない
  const bodies = [
    orbiting(0, 100, 0.4),
    orbiting(1, 135, 1.2),
    orbiting(2, 135, 1.2 + Math.PI),
    orbiting(3, 190, 2.6),
    orbiting(4, 190, 2.6 + Math.PI),
    orbiting(5, 275, 0.2),
    orbiting(6, 275, 0.2 + Math.PI),
    orbiting(7, 400, 1.9),
    orbiting(8, 400, 1.9 + Math.PI),
  ];
  return { bodies, heat, queue: [0, 1, 2], bestTier: 8 };
}

/** 小さい天体が 40 体ある混んだ盤面。 */
export function setupCrowded(heat = 55): SimulationSetup {
  const rng = createRng(11);
  const bodies: SetupBody[] = [];
  for (let i = 0; i < 40; i++) {
    const tier = (rng() < 0.5 ? 0 : rng() < 0.6 ? 1 : rng() < 0.7 ? 2 : 3) as Tier;
    bodies.push(orbiting(tier, 110 + ((i * 53) % 320), (i * Math.PI * 2) / 40 + rng() * 0.1));
  }
  return { bodies, heat, queue: [1, 0, 3], bestTier: 5 };
}

/** 同じ Tier が 2 体、すぐ融合する位置にある盤面（融合の演出の確認用）。 */
export function setupAboutToMerge(tier: Tier, heat = 30): SimulationSetup {
  const a = orbiting(tier, 280, 0);
  const b = orbiting(tier, 280, 0.6);
  return { bodies: [a, { ...b, vx: b.vx * 1.12, vy: b.vy * 1.12 }], heat, queue: [0, 0, 0], bestTier: tier };
}

/** 時計回りの接線に近い、無難な射出を 1 つ作る（自動プレイ用）。 */
export function randomLaunch(rng: () => number): LaunchCommand {
  const angle = rng() * Math.PI * 2;
  const inward = (rng() * 2 - 1) * 0.25;
  const speed = SPEED_MIN + rng() * (SPEED_MAX - SPEED_MIN - 10);
  const t = clockwiseTangent(angle);
  return {
    originAngleRadians: angle,
    vx: speed * (Math.cos(inward) * t.x - Math.sin(inward) * Math.cos(angle)),
    vy: speed * (Math.cos(inward) * t.y - Math.sin(inward) * Math.sin(angle)),
  };
}

/** 勝手に撃ち続けるシミュレーション（演出と音を「実戦に近い頻度」で確かめる用）。 */
export function createAutoPlay(seed = 5, setup?: SimulationSetup): { sim: SimulationPort; step(): readonly GameEvent[] } {
  const sim = createSimulation(seed, setup);
  const rng = createRng(seed + 1);
  let untilNext = 60;
  return {
    sim,
    step() {
      if (--untilNext <= 0) {
        sim.submitLaunch(randomLaunch(rng));
        untilNext = 150;
      }
      return sim.stepFixed();
    },
  };
}

let fakeSequence = 100000;

/** 1 個だけ手で作ったイベント（ボタンで演出を 1 つずつ確かめる用）。場所は (x, y)。 */
export function sampleEvent(kind: GameEventKind, tier: Tier = 0, x = 200, y = -120, chain = 1): GameEvent {
  const base = { sequence: fakeSequence++, tick: 0, kind, x, y, sourceTier: tier } as const;
  switch (kind) {
    case 'launch':
      return { ...base, x: LAUNCH_RADIUS, y: 0, bodyIds: [1] };
    case 'bounce':
      return { ...base, bodyIds: [1, 2] };
    case 'merge':
      return {
        ...base,
        bodyIds: [1, 2, 3],
        resultTier: Math.min(8, tier + 1) as Tier,
        scoreDelta: Math.round(TIER_BASE_SCORE[tier] * Math.min(3, 1 + 0.5 * (chain - 1))),
        heatDelta: -Math.min(8, 3 + tier),
        chain,
      };
    case 'supernova':
      return { ...base, sourceTier: 8, bodyIds: [1, 2], scoreDelta: 45000, heatDelta: -25, chain };
    case 'absorb':
      return { ...base, x: 40, y: 30, bodyIds: [1], heatDelta: 9 + 2 * tier };
    case 'escape':
      return { ...base, x: 420, y: -250, bodyIds: [1], heatDelta: 4 + tier };
    case 'densityPurge':
      return { ...base, bodyIds: [1], heatDelta: 8 };
    case 'gameOver':
      return { sequence: fakeSequence++, tick: 0, kind };
  }
}

function record(i: number, name: string, score: number, bestTier: number, maxChain: number, seconds: number): RunRecord {
  return {
    id: `sample-${i}`,
    name,
    score,
    bestTier,
    maxChain,
    seconds,
    launches: Math.round(seconds / 2.6),
    merges: Math.round(seconds / 5.5),
    supernovas: 0,
    heatFromAbsorb: 60 + i * 7,
    heatFromEscape: 90 - i * 4,
    heatFromPurge: i === 0 ? 16 : 0,
    seed: 1000 + i,
    playedAt: new Date(Date.UTC(2026, 9, 1 + i, 3, 20)).toISOString(),
    gameVersion: '0.1.0',
  };
}

/** ランキングと結果画面の見本（スコアの高い順、10 件）。 */
export const SAMPLE_RECORDS: RunRecord[] = [
  record(0, 'HAIGO', 128460, 7, 4, 742),
  record(1, 'PLAYER', 86300, 6, 3, 610),
  record(2, 'ながいなまえのひとです', 54120, 6, 2, 488),
  record(3, 'AAA', 37930, 5, 3, 401),
  record(4, 'PLAYER', 25260, 5, 2, 336),
  record(5, 'B', 17890, 5, 1, 390),
  record(6, 'PLAYER', 12470, 4, 2, 282),
  record(7, 'たろう', 9580, 4, 1, 228),
  record(8, 'PLAYER', 4215, 3, 1, 222),
  record(9, 'PLAYER', 200, 1, 1, 84),
];

export const SAMPLE_RESULT: ResultView = { record: SAMPLE_RECORDS[3]!, isBest: false, rank: 4 };
export const SAMPLE_RESULT_BEST: ResultView = { record: SAMPLE_RECORDS[0]!, isBest: true, rank: 1 };
