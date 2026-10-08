// 担当どうしの受け渡しの型。各担当は、ここに書かれた形の部品を作る。
// 変更できるのはリーダーだけ。変えてほしいときは docs/progress/<担当>.md の「リーダーへの依頼」に書く。
//
// 作る関数（名前と引数は固定）:
//   担当 B  src/render/index.ts   createBoardRenderer(canvas): BoardRenderer
//           src/render/bodies.ts  drawBody(ctx, tier, x, y, radius, options?)
//           src/input/index.ts    createPointerInput(canvas, deps): PointerInput
//   担当 C  src/effects/index.ts  createEffectsLayer(canvas, shakeTarget): EffectsLayer
//           src/audio/index.ts    createAudioManager(): AudioManager
//   担当 D  src/ui/index.ts       createLayout(root, onResize): Layout
//                                 createHud(root, onIntent): Hud
//                                 createOverlays(root, onIntent): Overlays
//           src/storage/index.ts  createSaveStore(): SaveStore
//                                 createRankingStore(save): RankingStore

import type {
  GameEvent,
  GameSnapshot,
  LaunchCommand,
  LaunchInput,
  Prediction,
  Tier,
} from './game';

export type AppState = 'title' | 'playing' | 'paused' | 'ending' | 'result';
export type HeatState = 'stable' | 'rising' | 'overheat' | 'critical';

export type Settings = {
  sfx: boolean;
  /** 0〜100 */
  volume: number;
  /** null は端末の設定に従う */
  reducedMotion: boolean | null;
  aimGuide: boolean;
};

// ───────── 担当 B: 盤面と照準 ─────────

/** 照準中の表示データ。入力（B）が作り、アプリ経由で盤面（B）に渡る。 */
export type AimView = Readonly<{
  originAngleRadians: number;
  tier: Tier;
  /** ドラッグ距離（CSS px） */
  dragPx: number;
  /** 撃ったときの速度（論理 px/秒） */
  vx: number;
  vy: number;
  speed: number;
  /** ドラッグが短く、核へまっすぐ落とす状態 */
  straight: boolean;
  prediction: Prediction | null;
  /** 射出点が他の天体と重なるなど、離しても撃てない */
  invalid: boolean;
}>;

export type BoardFrame = Readonly<{
  /** 1 tick 前と今の盤面。alpha（0〜1）で位置だけ補間して描く */
  prev: GameSnapshot;
  curr: GameSnapshot;
  alpha: number;
  /** 表示用の経過秒（脈動などに使う。一時停止中は進まない） */
  timeSeconds: number;
  aim: AimView | null;
  reducedMotion: boolean;
  aimGuide: boolean;
  /** 一時停止・結果の表示中は true（盤面を暗くする） */
  dimmed: boolean;
}>;

export interface BoardRenderer {
  /** 表示サイズ（CSS px の一辺）が変わったときに呼ばれる */
  resize(cssSize: number): void;
  draw(frame: BoardFrame): void;
}

export type DrawBodyOptions = {
  alpha?: number;
  /** 表示用の経過秒（Tier 8 の光輪の脈動など） */
  timeSeconds?: number;
  /** 模様の乱数の種（天体の ID を渡す） */
  seed?: number;
};

export type PointerInputDeps = {
  getSnapshot(): GameSnapshot;
  predict(command: LaunchCommand): Prediction;
  /** 照準の表示が変わるたびに呼ぶ。照準をやめたら null */
  onAim(aim: AimView | null): void;
  /** 有効な照準で離したときに呼ぶ（ドラッグなしで離した場合も、まっすぐ落とす射出として呼ぶ） */
  onLaunch(command: LaunchCommand): void;
};

export interface PointerInput {
  /** プレイ中だけ true。false の間は照準を始めない */
  setEnabled(enabled: boolean): void;
  /** 進行中の照準を取り消す */
  cancel(): void;
  dispose(): void;
}

// ───────── 担当 C: 演出と音 ─────────

/** 盤面の上に重ねた透明な Canvas に描く。盤面の描画（B）とは独立している。 */
export interface EffectsLayer {
  resize(cssSize: number): void;
  /** その tick に起きたイベントを 1 回ずつ受け取る */
  handleEvents(events: readonly GameEvent[], snapshot: GameSnapshot): void;
  /** 毎フレーム呼ばれる。dtSeconds は前フレームからの秒数（一時停止中は呼ばれない） */
  update(dtSeconds: number): void;
  draw(): void;
  /** 終了演出（0.55 秒）を始める */
  playGameOver(): void;
  setReducedMotion(on: boolean): void;
  /** 新しいプレイの開始時に、残っている演出を全部消す */
  clear(): void;
}

export type UiSound = 'button' | 'bestScore';

export interface AudioManager {
  /** 最初のユーザー操作（「はじめる」）で呼ばれる。AudioContext を作る */
  unlock(): void;
  setSettings(settings: Pick<Settings, 'sfx' | 'volume'>): void;
  handleEvents(events: readonly GameEvent[], snapshot: GameSnapshot): void;
  /** 熱量が「臨界」の間 true。警告音を鳴らす */
  setCritical(on: boolean): void;
  play(sound: UiSound): void;
  /** 一時停止などで音を止める */
  suspend(): void;
  resume(): void;
}

// ───────── 担当 D: 画面・保存・ランキング ─────────

export type RunRecord = {
  id: string;
  name: string;
  score: number;
  bestTier: number;
  maxChain: number;
  seconds: number;
  launches: number;
  merges: number;
  supernovas: number;
  seed: number;
  /** ISO 8601 */
  playedAt: string;
  gameVersion: string;
};

export type SaveDataV1 = {
  version: 1;
  playerName: string;
  bestScore: number;
  /** スコアの高い順に最大 10 件 */
  records: RunRecord[];
  lastRecordId: string | null;
  settings: Settings;
  hints: {
    /** 最初の合体を見たか（開始時の案内を出すかどうか） */
    firstMergeDone: boolean;
    /** 「引っぱると曲げて投げられる」を出したか */
    throwShown: boolean;
    /** 「限界リングを越えると熱量が上がる」を出したか */
    limitShown: boolean;
    chainShown: boolean;
  };
};

export interface SaveStore {
  /** 壊れていても必ず使える値を返す（SPEC.md 10.2） */
  load(): SaveDataV1;
  /** 保存が拒否されても例外を投げない */
  save(data: SaveDataV1): void;
}

export interface RankingStore {
  list(limit: number): Promise<RunRecord[]>;
  /** 記録を足し、順位（10 位以内でなければ null）を返す */
  submit(record: RunRecord, inputs: readonly LaunchInput[]): Promise<{ rank: number | null }>;
  rename(recordId: string, name: string): Promise<void>;
  clear(): Promise<void>;
}

export interface Layout {
  /** 今の盤面の一辺（CSS px） */
  getBoardSize(): number;
  dispose(): void;
}

export interface Hud {
  update(snapshot: GameSnapshot, bestScore: number): void;
  /** 盤面の下側に 1 行のヒントを出す。既に出ていたら置き換える */
  showToast(text: string, seconds?: number): void;
  /** 連鎖 2 以上が起きたときに呼ばれる（2 秒表示） */
  showChain(chain: number): void;
  setSfxOn(on: boolean): void;
}

export type OverlayScreen = 'title' | 'howto' | 'settings' | 'paused' | 'result';

export type ResultView = {
  record: RunRecord;
  isBest: boolean;
  rank: number | null;
};

export type OverlayData = {
  bestScore: number;
  settings: Settings;
  playerName: string;
  result?: ResultView;
};

/** 画面のボタンなどから、アプリへ伝える意図。状態を変えるのはアプリだけ。 */
export type UiIntent =
  | { kind: 'start' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'restart' }
  | { kind: 'backToTitle' }
  | { kind: 'openRanking' }
  | { kind: 'toggleSfx' }
  | { kind: 'settingsChanged'; settings: Settings }
  | { kind: 'rename'; name: string }
  | { kind: 'clearRecords' }
  | { kind: 'copyResult' };

export interface Overlays {
  /** null で全部閉じる。howto と settings は、閉じると直前の画面に戻る */
  show(screen: OverlayScreen | null, data: OverlayData): void;
  current(): OverlayScreen | null;
}
