// 【仮実装】担当 C が SPEC.md 8.1（音の列）・8.3・8.4 のとおりに作る。
// いまは何も鳴らさない。関数名と引数は変えないこと。

import type { AudioManager } from '../contracts/app';

export function createAudioManager(): AudioManager {
  return {
    unlock() {},
    setSettings() {},
    handleEvents() {},
    setCritical() {},
    play() {},
    suspend() {},
    resume() {},
  };
}
