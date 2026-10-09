// ゲームの数値はすべてここに置く。他のファイルに数値を直接書かない。
// 値を変えたら TUNING.md に 1 行残す。変更できるのはリーダーだけ。
//
// ルールの形（2026-10-08 に「軌道に乗せる」型から変更）:
//   外側の輪から撃った天体が核へ落ち、核のまわりに積もる。同じ階級が触れたら合体する。
//   積もった山が限界リングを越えている間だけ熱量が上がり、100 で終了。

export const TICK_HZ = 120;
export const DT = 1 / TICK_HZ;
export const MAX_FRAME_SECONDS = 0.05;
export const MAX_STEPS_PER_FRAME = 6;

// 盤面（論理座標。中心が (0, 0)、一辺 960）
export const BOARD_SIZE = 960;
export const CORE_RADIUS = 44;
/** 限界リング。積もった天体の外側の端がここを越えると熱量が上がる */
export const LIMIT_RADIUS = 320;
/** 射出リング。撃つ天体の中心が置かれる半径 */
export const LAUNCH_RADIUS = 425;
/** これより内側の押下は照準にしない（角度が不安定なため） */
export const AIM_MIN_RADIUS = 60;

// 重力と動き
/** 核へ向かう加速度。距離によらず一定（積もった山が安定するように） */
export const GRAVITY = 1500;
/** 空中での減速（毎秒の割合） */
export const AIR_DAMPING = 0.5;
/** 何かに触れている間の減速（毎秒の割合）。転がり続けるのを止める */
export const CONTACT_DAMPING = 5;
/** 触れていて、これより遅ければ止める */
export const SLEEP_SPEED = 4;
/** 重なりを解消する計算の繰り返し回数 */
export const SOLVER_ITERATIONS = 8;
/** この距離までの隙間は「触れている」とみなす */
export const CONTACT_SLOP = 0.6;

// 射出
/** タップだけのときに、核へまっすぐ落とす速さ */
export const DROP_SPEED = 260;
/** 引っぱって投げるときの速さの範囲 */
export const SPEED_MIN = 200;
export const SPEED_MAX = 620;
export const DRAG_MIN_PX = 24;
export const DRAG_MAX_PX = 150;
export const LAUNCH_COOLDOWN = 0.5;
export const LAUNCH_OVERLAP_MARGIN = 2;

// 合体
/** 合体で生まれた天体が、元の大きさから本来の大きさへ育つ時間（秒）。急に押しのけないため */
export const GROW_SECONDS = 0.12;

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
export const TIER_RADIUS = [14, 19, 25, 32, 41, 52, 66, 82, 100] as const;
/** その Tier の 2 体が合体したときの基礎点。[8] は超新星 */
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
export const HEAT_START = 0;
export const HEAT_MAX = 100;
/** 限界リングを越えた天体がある間の上昇（毎秒） */
export const HEAT_RISE_PER_SECOND = 22;
/** 越えた天体がない間の下降（毎秒） */
export const HEAT_COOL_PER_SECOND = 14;
/** 撃った直後・生まれた直後の天体を、限界の判定から外す時間（秒） */
export const LIMIT_GRACE_SECONDS = 1.2;
/** 超新星で下がる熱量 */
export const HEAT_SUPERNOVA = 40;
/** 安定 | 上昇 | 過熱 | 臨界 の境目 */
export const HEAT_STATE_LIMITS = [25, 50, 75] as const;

// 連鎖
/** 合体で生まれた天体が、この時間内にまた合体すると連鎖 */
export const CHAIN_WINDOW_SECONDS = 2.5;
export const CHAIN_STEP = 0.5;
export const CHAIN_MULT_MAX = 3.0;

// 次の天体（到達した最高 Tier が minBest 以上のときの確率。下の行が優先）
export const QUEUE_SIZE = 3;
export const QUEUE_TABLE = [
  { minBest: 0, weights: [0.7, 0.3] },
  { minBest: 2, weights: [0.45, 0.35, 0.2] },
  { minBest: 3, weights: [0.35, 0.3, 0.2, 0.15] },
  { minBest: 4, weights: [0.3, 0.25, 0.2, 0.15, 0.1] },
] as const;

/** 開始時に核の上（画面の真上側）に置いてある天体。最初の 1 射で合体を見せるため */
export const START_BODY = { tier: 0, angle: -Math.PI / 2 } as const;

// 予測
export const PREDICT_SECONDS = 1.6;
export const PREDICT_SAMPLE_SECONDS = 0.025;

// 表示（render/ effects/ が参照する）
export const TRAIL_SECONDS = 0.35;
export const TRAIL_POINTS = 16;
export const PARTICLE_CAP = 400;
export const FLOAT_TEXT_CAP = 12;
export const GAMEOVER_SECONDS = 0.55;

// 音（audio/ が参照する）
/** 同時に鳴らす音の上限 */
export const AUDIO_MAX_VOICES = 12;
/** 着地音は、この秒数の間に LAND_SOUND_MAX 回まで */
export const LAND_SOUND_WINDOW_SECONDS = 0.25;
export const LAND_SOUND_MAX = 4;
/** 設定の音量 100 のときの全体音量 */
export const AUDIO_MASTER_GAIN = 0.8;

export const DPR_CAP = 2;
