// 貼り付けられた文章の中から共有文字列を取り出す。
// 「URL をそのまま貼った」「説明文ごとコピーした」形で届いても再生できるようにするための、
// decodePlay の手前に置く緩い入口。文字列が正当かどうかの判定自体は decodePlay に任せ、
// ここでは候補を拾って渡すだけにする。
//
// 拾い方: base64url の文字（A-Z a-z 0-9 - _）だけが続く「連なり」を全部集め、
// 長い物から順に decodePlay へ通し、最初に通った物を返す。
// URL に埋め込まれた共有文字列は、ほかの部分（ホスト名・パラメータ名など）より
// 長い連なりになることがほとんどなので、長い順に試す。
//
// 限界: 前後に base64url の文字が区切りなしでくっ付いていると、
// その文字まで連なりの一部に見えてしまい取り出せない。
// （共有文字列とゴミを切り分ける目印が、この形式には無いため。
//   URL に載せるなら ? # / = などの区切りを挟む約束事が要る）

import { decodePlay, MAX_TEXT_LENGTH } from './codec';

// 正当な共有文字列は最小でも 9 バイト（本体 5 + 検査値 4）= base64 で 12 文字ある。
// それより短い連なりは絶対に共有文字列ではないので、拾う時点で省く。
const RUN_PATTERN = /[A-Za-z0-9_-]{12,}/g;
/** 拾う連なりの数の上限。十分な数を先に現れた順に集めればよい（あとは長い順に絞る）。
 *  テストが上限まわりの振る舞いを上限値と連動して確かめられるよう export してある（./index の公開面には出さない）。 */
export const MAX_CANDIDATES = 4096;
/** decodePlay にかける候補の数（長い順）。でたらめな連なりが大量にある文章でも作業量を抑える。
 *  同上の理由で export。 */
export const MAX_ATTEMPTS = 64;

/**
 * 文章から共有文字列を探して返す。文章自体が共有文字列なら（前後の空白を除いて）そのまま返る。
 * 見つからなければ null を返し、例外は投げない。返した文字列は decodePlay / verifyPlay に渡せる。
 */
export function extractShareText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text.length === 0) return null;

  const candidates: string[] = [];
  for (const m of text.matchAll(RUN_PATTERN)) {
    const run = m[0];
    if (run.length <= MAX_TEXT_LENGTH) candidates.push(run);
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  // 長い順。sort は安定なので、同じ長さどうしは先に現れた物が先に来る
  candidates.sort((a, b) => b.length - a.length);
  for (const run of candidates.slice(0, MAX_ATTEMPTS)) {
    if (decodePlay(run).ok) return run;
  }
  return null;
}
