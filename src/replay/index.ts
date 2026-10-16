// プレイの再生。外から使うのはここから見える物だけにする。

export {
  REPLAY_FORMAT,
  createReplayRecord,
  parseReplay,
  rulesVersion,
  serializeReplay,
  snapshotHash,
  type ReplayRecord,
} from './record';
export {
  createReplayPlayer,
  keyframeInterval,
  type ReplayPlayer,
  type ReplayStart,
} from './player';
export { findHighlights, type HighlightsResult, type ReplayHighlight, type HighlightKind } from './highlights';
export { analyzeCause, type CauseResult, type DefeatCause } from './cause';
// runReplay: プレイヤーを立てずに「記録が今のルールと合うか」だけ確かめる窓口
// （共有された記録の取り込み検証など）。プレイヤーは内部でこれを使っている。
export {
  CHECKPOINT_EVERY,
  runReplay,
  type IndexedEvent,
  type ReplayFailure,
  type ReplayRun,
  type RunOptions,
} from './engine';
