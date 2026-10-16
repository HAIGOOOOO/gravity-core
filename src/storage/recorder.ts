// プレイ中の出来事を 1 tick ずつ受け取って数える蓄積器。
// アプリ側は「来た分をそのまま渡す」だけでよく、出来事の列をプレイ終わりまで持ち越さなくて済む。
// 終了時に finish を 1 回呼んで統計に仕上げ、次のプレイの前に reset を呼ぶ。

import type { GameEvent, GameSnapshot } from '../contracts/game';
import type { EventFold, RunDetailMeta, RunDetailV1 } from './stats';
import { createEventFold, finishFold, foldEvent } from './stats';

export interface RunRecorder {
  /** その tick に起きた出来事を渡す（stepFixed の戻り値をそのまま渡せる） */
  feed(events: readonly GameEvent[]): void;
  /** 最後の盤面と識別情報から統計を作る。何度呼んでも同じ結果で、内部状態は変わらない */
  finish(snapshot: GameSnapshot, meta: RunDetailMeta): RunDetailV1;
  /** 次のプレイのために数え上げを空にする */
  reset(): void;
}

export function createRunRecorder(): RunRecorder {
  let fold: EventFold = createEventFold();
  return {
    feed(events) {
      for (const event of events) foldEvent(fold, event);
    },
    finish(snapshot, meta) {
      return finishFold(fold, snapshot, meta);
    },
    reset() {
      fold = createEventFold();
    },
  };
}
