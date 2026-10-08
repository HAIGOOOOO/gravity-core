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
}>;

export type LaunchCommand = Readonly<{
  originAngleRadians: number;
  /** 論理 px/秒 */
  vx: number;
  vy: number;
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
}>;

export type LaunchInput = Readonly<{
  tick: Tick;
  originAngleRadians: number;
  vx: number;
  vy: number;
}>;

export interface SimulationPort {
  getSnapshot(): GameSnapshot;
  submitLaunch(command: LaunchCommand): LaunchResult;
  /** 1 tick 進め、その tick のイベントを返す */
  stepFixed(): readonly GameEvent[];
  /** 状態を変えない */
  predict(command: LaunchCommand): Prediction;
  getInputLog(): readonly LaunchInput[];
}
