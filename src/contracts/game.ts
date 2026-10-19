// ゲームの計算（src/game/）と、それ以外の全部分が共有する型。
// 変更できるのはリーダーだけ（AGENTS.md 参照）。

export type Tier = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type BodyId = number;
/** 1 tick = 1/120 秒 */
export type Tick = number;

export type BodyView = Readonly<{
  id: BodyId;
  tier: Tier;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 今の半径。合体で生まれた直後は、本来の大きさへ育つ途中 */
  radius: number;
  bornTick: Tick;
  chain: number;
  chainUntilTick: Tick;
  /** 外側の端が限界リングを越えていて、熱量を上げている */
  overLimit: boolean;
}>;

export type RunStats = Readonly<{
  launches: number;
  merges: number;
  supernovas: number;
  maxChain: number;
}>;

export type GameSnapshot = Readonly<{
  tick: Tick;
  phase: 'active' | 'over';
  bodies: readonly BodyView[];
  heat: number;
  /** 限界リングを越えた天体が 1 つ以上ある（熱量が上がっている） */
  overLimit: boolean;
  score: number;
  bestTierThisRun: Tier;
  nextQueue: readonly [Tier, Tier, Tier];
  launchCooldownLeftSeconds: number;
  seed: number;
  stats: RunStats;
  /** 重力操作の今の状態。重力操作が無効の計算では付かない（試作: dev/gravity-lab.html） */
  gravity?: GravityView;
}>;

export type LaunchCommand = Readonly<{
  originAngleRadians: number;
  /** 論理 px/秒 */
  vx: number;
  vy: number;
  /** ゲージが満タンの瞬間に離した「重力弾」（試作。重力操作が有効の計算だけで効く） */
  charged?: boolean;
}>;

export type LaunchRejectReason = 'cooldown' | 'overlap' | 'speed' | 'gameOver';

export type LaunchResult =
  | { accepted: true; bodyId: BodyId }
  | { accepted: false; reason: LaunchRejectReason };

export type GameEventKind =
  /** 撃った */
  | 'launch'
  /** 撃った天体が、初めて何かに触れた */
  | 'land'
  /** 同じ Tier が合体して 1 つ上の Tier が生まれた */
  | 'merge'
  /** Tier 8 どうしが合体して消えた */
  | 'supernova'
  /** 山が限界リングを越えた（熱量が上がり始めた） */
  | 'overLimitStart'
  /** 越えた天体がなくなった（熱量が下がり始めた） */
  | 'overLimitEnd'
  | 'gameOver';

export type GameEvent = Readonly<{
  sequence: number;
  tick: Tick;
  kind: GameEventKind;
  x?: number;
  y?: number;
  bodyIds?: readonly BodyId[];
  sourceTier?: Tier;
  resultTier?: Tier;
  scoreDelta?: number;
  heatDelta?: number;
  chain?: number;
  /** land のとき: ぶつかった速さ（音や演出の強さに使う） */
  impactSpeed?: number;
}>;

export type PathPoint = Readonly<{ x: number; y: number; t: number }>;

/** いまの盤面が止まっていると仮定して、撃った天体が最初に何かへ触れるまでの道すじ。 */
export type Prediction = Readonly<{
  valid: boolean;
  rejectReason?: LaunchRejectReason;
  points: readonly PathPoint[];
  /** core: 核に着く / body: 天体に当たる / timeLimit: 時間内にどこにも着かない */
  end: 'core' | 'body' | 'timeLimit';
  /** 最初に当たる天体。当たらなければ null */
  hitBodyId: BodyId | null;
  /** 最初に当たる天体が同じ Tier（当たれば合体する） */
  willMerge: boolean;
  /** 重力操作で山が動いていて、当たり先を言い切れない。このとき hitBodyId は null（道すじは全長） */
  uncertain?: boolean;
}>;

export type LaunchInput = Readonly<{
  tick: Tick;
  originAngleRadians: number;
  vx: number;
  vy: number;
  /** 重力弾（試作）。共有の文字列にはまだ入らない */
  charged?: boolean;
}>;

// ───────── 重力操作（試作）─────────
// 射出とは別の入力。射出の記録（LaunchInput）の形は変えず、別の記録（GravityInput）に残す。

export type GravityCommand =
  /** 握る: on で握り始め、off で離す */
  | Readonly<{ kind: 'grip'; on: boolean }>
  /** 井戸を置く: 論理座標 (x, y) */
  | Readonly<{ kind: 'well'; x: number; y: number }>
  /** 渦: 1 = 時計回り、-1 = 反時計回り、0 = 手を離す */
  | Readonly<{ kind: 'vortex'; dir: -1 | 0 | 1 }>
  /** 崩壊（ワンポチの大技）: 合体でためた力で、山全体を締めて同じ天体を寄せる */
  | Readonly<{ kind: 'collapse' }>;

export type GravityRejectReason =
  /** 重力操作が無効の計算 */
  | 'disabled'
  | 'gameOver'
  /** すでにその状態（握っている最中にもう一度握る、など）。記録には残さない */
  | 'noChange'
  /** 握り: 締まっている途中 / 井戸: 前の井戸がまだある */
  | 'busy'
  /** 井戸の持ち数が無い */
  | 'noCharge'
  /** 井戸を置けない場所（核の中、射出リングの外） */
  | 'outOfBoard';

export type GravityResult = { accepted: true } | { accepted: false; reason: GravityRejectReason };

export type GravityInput = Readonly<{ tick: Tick; command: GravityCommand }>;

export type GravityView = Readonly<{
  grip: Readonly<{
    held: boolean;
    /** 握りの溜まり具合（0〜1）。握った時間 ÷ 最長 */
    charge: number;
    /** 離した後、締まっている残り秒数 */
    squeezeLeftSeconds: number;
    /** いま離したら、同じ Tier が引き合う隙間の上限。締まっている間は、効いている値 */
    pullRange: number;
  }>;
  well: Readonly<{ x: number; y: number; leftSeconds: number; radius: number }> | null;
  wellCharges: number;
  /** 次の井戸がたまるまでに済んだ合体の数 */
  wellMergeProgress: number;
  vortex: Readonly<{ dir: -1 | 0 | 1; /** 今の回転の強さ（-1〜1） */ spin: number }>;
  /** 崩壊の力のたまり具合。value が max に届くと ready */
  burst: Readonly<{ value: number; max: number; ready: boolean }>;
  /** 崩壊の残り秒数（0 なら起きていない） */
  collapseLeftSeconds: number;
  /** 重力弾が着いた所で、同じ天体を引き寄せている天体と、その残り秒数 */
  pulses: readonly Readonly<{ bodyId: BodyId; leftSeconds: number; range: number }>[];
  /** 重力操作で山が動いている（予測の当たり先は言い切れない） */
  unstable: boolean;
  /** 重力操作のせいで熱量が冷めない */
  coolingBlocked: boolean;
  /** 重力操作が今足している熱量（毎秒） */
  heatPerSecond: number;
}>;

export interface SimulationPort {
  getSnapshot(): GameSnapshot;
  submitLaunch(command: LaunchCommand): LaunchResult;
  /** 1 tick 進め、その tick のイベントを返す */
  stepFixed(): readonly GameEvent[];
  /** 状態を変えない */
  predict(command: LaunchCommand): Prediction;
  getInputLog(): readonly LaunchInput[];
  /** 重力操作を入れる。受け付けた物は、今の tick を付けて記録に残る */
  submitGravity(command: GravityCommand): GravityResult;
  getGravityLog(): readonly GravityInput[];
}
