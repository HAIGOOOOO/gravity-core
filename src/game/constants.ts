// ゲームの数値はすべてここに置く（SPEC.md 14 章）。他のファイルに数値を直接書かない。
// 値を変えたら TUNING.md に 1 行残す。変更できるのはリーダーだけ。

export const TICK_HZ = 120;
export const DT = 1 / TICK_HZ;
export const MAX_FRAME_SECONDS = 0.05;
export const MAX_STEPS_PER_FRAME = 6;

// 盤面
export const BOARD_SIZE = 960;
export const CORE_RADIUS = 48;
export const LAUNCH_RADIUS = 405;
export const OUT_RADIUS = 485;
export const OUT_SECONDS = 0.25;
/** これより内側の押下は照準にしない */
export const AIM_MIN_RADIUS = 120;

// 重力
export const MU = 16_000_000;
export const SOFTENING = 32;

// 射出
export const SPEED_MIN = 110;
export const SPEED_MAX = 200;
export const DRAG_MIN_PX = 24;
export const DRAG_MAX_PX = 145;
export const LAUNCH_COOLDOWN = 0.45;
export const LAUNCH_OVERLAP_MARGIN = 2;

// 衝突
export const RESTITUTION = 0.55;
export const TANGENT_DAMPING = 0.03;
export const BOUNCE_EVENT_MIN_SPEED = 30;
export const MERGE_GRACE = 0.12;
export const MERGE_SPEED_BASE = 270;
export const MERGE_SPEED_PER_TIER = 13;
export const MERGE_SPEED_FLOOR = 150;
export const BODY_CAP = 48;

// 天体（添字が Tier）
export const TIER_COUNT = 9;
export const TIER_NAMES = [
  '小粒子',
  '隕石',
  '小惑星',
  '衛星',
  '小型惑星',
  '惑星',
  '巨大惑星',
  '恒星前駆体',
  '恒星級天体',
] as const;
export const TIER_RADIUS = [9, 12, 16, 20, 25, 31, 38, 46, 55] as const;
/** [8] は超新星 */
export const TIER_BASE_SCORE = [100, 220, 480, 1000, 2100, 4400, 9200, 19000, 45000] as const;
export const TIER_COLOR = [
  '#83D9FF',
  '#5CA8FF',
  '#8F89FF',
  '#A38BFF',
  '#E18DE6',
  '#FFA978',
  '#FFB45E',
  '#FFD66B',
  '#FFF2B2',
] as const;

// 熱量
export const HEAT_START = 15;
export const HEAT_MAX = 100;
export const HEAT_COOL_PER_SECOND = 0.35;
/** 核落下: BASE + PER_TIER × Tier */
export const HEAT_ABSORB_BASE = 9;
export const HEAT_ABSORB_PER_TIER = 2;
/** 流出: BASE + PER_TIER × Tier */
export const HEAT_ESCAPE_BASE = 4;
export const HEAT_ESCAPE_PER_TIER = 1;
export const HEAT_PURGE = 8;
/** 融合: −min(CAP, BASE + Tier) */
export const HEAT_MERGE_BASE = 3;
export const HEAT_MERGE_CAP = 8;
export const HEAT_SUPERNOVA = 25;
/** 安定 | 上昇 | 過熱 | 臨界 の境目 */
export const HEAT_STATE_LIMITS = [40, 70, 90] as const;

// 連鎖
export const CHAIN_WINDOW_SECONDS = 4.0;
export const CHAIN_STEP = 0.5;
export const CHAIN_MULT_MAX = 3.0;

// 次の天体（到達した最高 Tier が minBest 以上のときの確率。下の行が優先）
export const QUEUE_SIZE = 3;
export const QUEUE_TABLE = [
  { minBest: 0, weights: [1.0] },
  { minBest: 1, weights: [0.7, 0.3] },
  { minBest: 3, weights: [0.5, 0.3, 0.2] },
  { minBest: 5, weights: [0.4, 0.3, 0.2, 0.1] },
  { minBest: 7, weights: [0.3, 0.3, 0.2, 0.15, 0.05] },
] as const;

// 開始時の盤面と初回の案内
export const START_BODY = { tier: 0, radius: 345, angle: 0, clockwise: true } as const;
/** 初期天体より進行方向へ */
export const GUIDE_LEAD_DEGREES = 12;
/** 接線から内側へ */
export const GUIDE_INWARD_DEGREES = 20;
export const GUIDE_SPEED = 125;
export const GUIDE_MAX_SHOTS = 5;

// 予測
export const PREDICT_SECONDS = 2.5;
export const PREDICT_SAMPLE_SECONDS = 0.05;
export const PREDICT_MARKER_SECONDS = 0.5;
export const PREDICT_FATE_SECONDS = 20;
/** 半径の和 × この値以内で「出会う」 */
export const MEET_DISTANCE_FACTOR = 1.5;

// 表示（render/ effects/ が参照する）
export const TRAIL_SECONDS = 0.8;
export const TRAIL_POINTS = 24;
export const RESONANCE_DISTANCE_FACTOR = 4;
export const RESONANCE_MAX_LINES = 6;
export const PARTICLE_CAP = 300;
export const FLOAT_TEXT_CAP = 12;
export const GAMEOVER_SECONDS = 0.55;
export const DPR_CAP = 2;
