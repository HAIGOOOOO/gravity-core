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
/**
 * 連鎖の見えない猶予（秒）。期限（chainUntilTick）を少し過ぎた合体も連鎖に数える。
 * 画面の期限は変えない。「ぎりぎり間に合った」と感じる側に倒すため（docs/手応え.md 4 章）
 */
export const CHAIN_GRACE_SECONDS = 0.085;
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

// ---- 時間を止める・遅くする（ヒットストップとスロー。演出の側が頼み、進行役が上限をかける） ----
/** これより遅い速さは「止まっている」と数える */
export const TIME_STOP_BELOW = 0.05;
/** 続けて止めてよい長さ（秒）。超えたら、下の長さだけ必ず ふつうの速さに戻す */
export const HITSTOP_MAX_SECONDS = 0.15;
export const HITSTOP_RECOVER_SECONDS = 0.08;
/** スローの一番遅い速さと、続けてよい長さ（秒）。超えたら、下の長さだけ ふつうに戻す */
export const SLOWMO_MIN_SCALE = 0.2;
export const SLOWMO_MAX_SECONDS = 3;
export const SLOWMO_RECOVER_SECONDS = 0.5;

// ───────── 重力操作の試作（dev/gravity-lab.html）─────────
// 既定では無効。createSimulation の第 3 引数を渡したときだけ効く。
// ここの値は「既定値」で、見本ページのスライダーがその場で上書きする。

// 握る: 押している間、山にかかる重力が外向きになってふくらむ。離すと締まり、同じ天体が寄る。
/** 握っている間、山を外へ押す加速度 */
export const GRIP_SWELL_ACCEL = 520;
/** 握っている間の山の減速（毎秒の割合）。ふくらむ速さの上限 = 加速度 ÷ これ */
export const GRIP_DRAG = 6;
/** 握り続けられる最長の秒数。越えたら自動で離す（無限にふくらまないように） */
export const GRIP_MAX_HOLD_SECONDS = 1.4;
/** 握っている間に上がる熱量（毎秒）。握りの代償 */
export const GRIP_HEAT_PER_SECOND = 26;
/** 離した後、締まっている時間（秒）。この間は同じ天体が引き合い、熱量は冷めない */
export const GRIP_SQUEEZE_SECONDS = 0.8;
/** 締まっている間の、核への重力の倍率 */
export const GRIP_SQUEEZE_GRAVITY = 1.4;
/** これより短い握り（溜めの割合）は、離しても締まらない。溜め 0 の連打を代償なしの圧縮にしない（10/18 審査 1） */
export const GRIP_MIN_CHARGE = 0.15;
/** 締まっている間、同じ Tier どうしが引き合う加速度 */
export const GRIP_PULL_ACCEL = 1400;
/** 最長まで握ったときに、同じ Tier が引き合う隙間の上限（短く握るとこれより狭い） */
export const GRIP_PULL_RANGE = 80;
/** 外側の端がこの半径を越えた天体は、それ以上は外へ押さない */
export const GRIP_SWELL_LIMIT_RADIUS = 310; // 限界リング（320）の内側。ふくらむだけで熱量が上がらないように（10/18 審査 2）
/** 握っている間と締まっている間の、山の天体の速さの上限（挟まれた天体が盤面の外まで弾かれないように） */
export const GRIP_BODY_SPEED_CAP = 420;

// 井戸: 盤面に数秒だけ効く 2 つ目の引力点を置く。
/** 井戸の引く加速度の最大（撃った天体に対して） */
export const WELL_ACCEL = 3000;
/** 井戸が届く距離 */
export const WELL_RADIUS = 240;
/** 井戸の中心付近で力をなだらかにする距離（震えないように） */
export const WELL_SOFT_RADIUS = 34;
/** 井戸の中心付近にいる天体の減速（毎秒の割合）。行ったり来たりを止める */
export const WELL_CORE_DAMPING = 7;
/** 井戸が効く秒数 */
export const WELL_SECONDS = 4;
/** 消える前に力を弱めていく秒数（山が急に跳ねないように） */
export const WELL_FADE_SECONDS = 0.6;
/** 積もった山が井戸に引かれる割合（撃った天体を 1 として） */
export const WELL_PILE_FACTOR = 0.25; // 1 だと山が持ち上がって限界を越え、使うほど不利だった（10/18 審査 4）
/** 井戸の持ち数の上限と、開始時の数 */
export const WELL_MAX_CHARGES = 2;
export const WELL_START_CHARGES = 1;
/** 合体を何回すると井戸が 1 個たまるか。井戸の代償（回数制） */
export const WELL_MERGES_PER_CHARGE = 3;
/** 井戸がある間に上がる熱量（毎秒）。既定は 0（ある間は冷めないだけ） */
export const WELL_HEAT_PER_SECOND = 0;

// 渦: 重力に横向きの成分を足して、山を核のまわりに回す。
// 全体を同じだけ回しても、丸い盤面では何も変わらない。そこで「限界リングに近い天体ほど強く流す」形にして、
// 山の高い所だけが横へ流れて低い所へ落ちるようにしている。
/** 限界リングの位置で、流れが目指す横向きの速さ（回転が最大のとき） */
export const VORTEX_SPEED = 260;
/** 限界リングの位置での横向きの加速度の上限。重力の 0.6 倍くらいを越えると、天体が隣を乗り越え始める */
export const VORTEX_ACCEL = 1100;
/** 限界リングからこの深さまで流れが届く（それより内側の天体は流されない） */
export const VORTEX_DEPTH = 170;
/** 流れが届かない内側にも効かせる割合（1 にすると全体が同じ強さで回る。比べる用で、既定は 0） */
export const VORTEX_INNER_FACTOR = 0;
/** 天体の横向きの速さが、流れの速さへ近づく強さ（毎秒の割合） */
export const VORTEX_FOLLOW = 8;
/** 押してから回転が最大になるまでの秒数 */
export const VORTEX_SPIN_UP_SECONDS = 0.25;
/** 離してから回転が止まるまでの秒数（惰性。すぐには止まらない） */
export const VORTEX_SPIN_DOWN_SECONDS = 0.9;
/** 回転が最大のときに上がる熱量（毎秒）。回転の強さに比例する。渦の代償 */
export const VORTEX_HEAT_PER_SECOND = 18;

/** 重力操作で山が動いている間、限界の判定に持たせる幅（判定がちらつかないように） */
export const LIMIT_HYSTERESIS = 5;
