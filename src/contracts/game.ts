// ゲームの計算（src/game/）と、それ以外の全部分が共有する型。
// 正本は SPEC.md の 11.5。変更できるのはリーダーだけ（AGENTS.md 参照）。

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
  radius: number;
  bornTick: Tick;
  chain: number;
  chainUntilTick: Tick;
}>;

export type RunStats = Readonly<{
  launches: number;
  merges: number;
  supernovas: number;
  maxChain: number;
  heatFromAbsorb: number;
  heatFromEscape: number;
  heatFromPurge: number;
}>;

export type GameSnapshot = Readonly<{
  tick: Tick;
  phase: 'active' | 'over';
  bodies: readonly BodyView[];
  heat: number;
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
  | 'launch'
  | 'bounce'
  | 'merge'
  | 'absorb'
  | 'escape'
  | 'densityPurge'
  | 'supernova'
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
  tooFast?: boolean;
}>;

export type Fate = 'orbit' | 'core' | 'outside';

export type PathPoint = Readonly<{ x: number; y: number; t: number }>;

export type RivalPrediction = Readonly<{
  bodyId: BodyId;
  markers: readonly PathPoint[];
  /** 出会う時刻（秒）。出会わなければ null */
  meetAt: number | null;
  /** 出会う場所（2 体の中間）。meetAt が null のときは 0 */
  meetX: number;
  meetY: number;
  /** 出会う時刻の相対速度が融合しきい速度以下か */
  canMerge: boolean;
}>;

export type Prediction = Readonly<{
  valid: boolean;
  rejectReason?: LaunchRejectReason;
  /** 0.05 秒刻み、最大 2.5 秒 */
  points: readonly PathPoint[];
  end: 'timeLimit' | 'core' | 'outside';
  /** 20 秒先までの判定 */
  fate: Fate;
  /** 0.5 秒おき */
  markers: readonly PathPoint[];
  rivals: readonly RivalPrediction[];
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
