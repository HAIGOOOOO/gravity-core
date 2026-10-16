// 共有文字列の公開面。ほかの層（UI・統合）からはここだけを import する想定。
// 低レベルの道具（./coding）は内部用で、テストが同じフォルダから直接 import する。
export {
  decodePlay,
  encodePlay,
  MAX_TEXT_LENGTH,
  SHARE_FORMAT_VERSION,
  SHARE_RULES_VERSION,
} from './codec';
export type { DecodeFailReason, DecodePlayResult, EncodePlayArgs, SharePlay } from './codec';
export { extractShareText } from './extract';
export { verifyPlay } from './verify';
export type { VerifiedPlay, VerifyFailReason, VerifyOptions, VerifyPlayResult } from './verify';
