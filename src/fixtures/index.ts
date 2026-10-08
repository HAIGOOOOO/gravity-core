// 見本データ（リーダー担当）。各担当の見本ページ（dev/*.html）とテストで使う。
// 本物の計算（src/game/）で作っているので、数値は本番と同じ形になる。

import type { ResultView, RunRecord } from '../contracts/app';
import type { GameEvent, GameEventKind, LaunchCommand, SimulationPort, Tier } from '../contracts/game';
import { CORE_RADIUS, DROP_SPEED, LAUNCH_RADIUS, TIER_BASE_SCORE, TIER_RADIUS } from '../game/constants';
import { createRng } from '../game/rng';
import { createSimulation, type SimulationSetup } from '../game/simulation';

type SetupBody = NonNullable<SimulationSetup['bodies']>[number];

/** 核の表面（角度 angle）に置いた天体。 */
export function onCore(tier: Tier, angle: number, lift = 0): SetupBody {
  const r = CORE_RADIUS + TIER_RADIUS[tier] + lift;
  return { tier, x: r * Math.cos(angle), y: r * Math.sin(angle) };
}

/** 中心から距離 r・角度 angle に置いた天体（落ちて積もる）。 */
export function at(tier: Tier, r: number, angle: number): SetupBody {
  return { tier, x: r * Math.cos(angle), y: r * Math.sin(angle) };
}

/** Tier 0〜8 が 1 体ずつある盤面（合体しない組み合わせ）。 */
export function setupAllTiers(heat = 0): SimulationSetup {
  const bodies = [
    at(8, 150, -1.6),
    at(7, 135, 0.6),
    at(6, 120, 2.6),
    at(5, 250, 1.7),
    at(4, 250, -0.4),
    at(3, 250, 3.6),
    at(2, 300, 0.1),
    at(1, 300, 2.2),
    at(0, 300, 4.4),
  ];
  return { bodies, heat, queue: [0, 1, 2], bestTier: 8 };
}

/** まっすぐ落とす射出（角度だけ決める）。 */
export function dropAt(angle: number): LaunchCommand {
  return { originAngleRadians: angle, vx: -Math.cos(angle) * DROP_SPEED, vy: -Math.sin(angle) * DROP_SPEED };
}

/** ランダムな方角からまっすぐ落とす射出（自動プレイ用）。 */
export function randomLaunch(rng: () => number): LaunchCommand {
  return dropAt(rng() * Math.PI * 2);
}

/**
 * 勝手に撃ち続けるシミュレーション（演出と音を「実戦に近い頻度」で確かめる用）。
 * @param warmupSeconds 先にこの秒数ぶん進めて、山ができた状態から始める
 */
export function createAutoPlay(
  seed = 5,
  setup?: SimulationSetup,
  warmupSeconds = 0,
): { sim: SimulationPort; step(): readonly GameEvent[] } {
  const sim = createSimulation(seed, setup);
  const rng = createRng(seed + 1);
  let untilNext = 60;
  const auto = {
    sim,
    step(): readonly GameEvent[] {
      if (--untilNext <= 0) {
        sim.submitLaunch(randomLaunch(rng));
        untilNext = 110;
      }
      return sim.stepFixed();
    },
  };
  for (let i = 0; i < warmupSeconds * 120 && sim.getSnapshot().phase === 'active'; i++) auto.step();
  return auto;
}

let fakeSequence = 100000;

/** 1 個だけ手で作ったイベント（ボタンで演出を 1 つずつ確かめる用）。場所は (x, y)。 */
export function sampleEvent(kind: GameEventKind, tier: Tier = 0, x = 160, y = -120, chain = 1): GameEvent {
  const base = { sequence: fakeSequence++, tick: 0, kind, x, y, sourceTier: tier } as const;
  switch (kind) {
    case 'launch':
      return { ...base, x: LAUNCH_RADIUS, y: 0, bodyIds: [1] };
    case 'land':
      return { ...base, bodyIds: [1], impactSpeed: 600 };
    case 'merge':
      return {
        ...base,
        bodyIds: [1, 2, 3],
        resultTier: Math.min(8, tier + 1) as Tier,
        scoreDelta: Math.round(TIER_BASE_SCORE[tier] * Math.min(3, 1 + 0.5 * (chain - 1))),
        chain,
      };
    case 'supernova':
      return { ...base, sourceTier: 8, bodyIds: [1, 2], scoreDelta: 45000, heatDelta: -40, chain };
    case 'overLimitStart':
    case 'overLimitEnd':
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
    launches: Math.round(seconds / 1.8),
    merges: Math.round(seconds / 2.4),
    supernovas: 0,
    seed: 1000 + i,
    playedAt: new Date(Date.UTC(2026, 9, 1 + i, 3, 20)).toISOString(),
    gameVersion: '0.2.0',
  };
}

/** ランキングと結果画面の見本（スコアの高い順、10 件）。 */
export const SAMPLE_RECORDS: RunRecord[] = [
  record(0, 'HAIGO', 128460, 7, 6, 742),
  record(1, 'PLAYER', 86300, 6, 5, 610),
  record(2, 'ながいなまえのひとです', 54120, 6, 4, 488),
  record(3, 'AAA', 37930, 5, 4, 401),
  record(4, 'PLAYER', 25260, 5, 3, 336),
  record(5, 'B', 17890, 5, 3, 390),
  record(6, 'PLAYER', 12470, 4, 2, 282),
  record(7, 'たろう', 9580, 4, 2, 228),
  record(8, 'PLAYER', 4215, 3, 2, 222),
  record(9, 'PLAYER', 200, 1, 1, 84),
];

export const SAMPLE_RESULT: ResultView = { record: SAMPLE_RECORDS[3]!, isBest: false, rank: 4 };
export const SAMPLE_RESULT_BEST: ResultView = { record: SAMPLE_RECORDS[0]!, isBest: true, rank: 1 };
