// 送る側はプレイ中なら encodeSimulation、保存の記録からなら encodeReplayShare を使う。
// 受け取る側は shareToReplayAsync で盤面と得点を計算し直し、結果を再生へ渡す。
// 文章からコードを取り出す必要がある場合は、先に extractShareText を使う。
export {
  decodePlay,
  encodePlay,
  encodeSimulation,
  MAX_TEXT_LENGTH,
  SHARE_FORMAT_VERSION,
  SHARE_RULES_VERSION,
} from './codec';
export type { DecodeFailReason, DecodePlayResult, EncodePlayArgs, SharePlay } from './codec';
export { extractShareText } from './extract';
export { decodeReplayShare, encodeReplayShare, shareToReplay, verifyPlay } from './verify';
export type { ShareReplayResult, VerifiedPlay, VerifyFailReason, VerifyOptions, VerifyPlayResult } from './verify';
export { shareToReplayAsync, type AsyncShareReplay } from './async';
export { createResultImage, type ResultImageSource } from './result-image';
