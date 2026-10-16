// 共有文字列の公開面。ほかの層（UI・統合）からはここだけを import する想定。
// 渡す側: プレイ中は encodeSimulation(sim)（手で値を組むなら encodePlay。endTick を省略すると
//         「最後の入力の tick」までの再生になる点に注意）。
// 受け取る側: 貼り付けられた文章なら extractShareText で取り出し、verifyPlay で再生して
//         得点を計算し直す。止まってはいけない所から呼ぶなら verifyPlay(text, { maxTicks })。
// 低レベルの道具（./coding）は内部用で、テストが同じフォルダから直接 import する。
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
export { verifyPlay } from './verify';
export type { VerifiedPlay, VerifyFailReason, VerifyOptions, VerifyPlayResult } from './verify';
