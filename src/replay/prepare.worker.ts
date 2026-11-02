import { runReplay } from './engine';
import { keyframeInterval } from './player';
import type { ReplayRecord } from './record';

// 状態のコピーはstructured cloneに任せ、-0を失うJSON経由にしない。
self.addEventListener('message', (event: MessageEvent<ReplayRecord>) => {
  const record = event.data;
  self.postMessage(runReplay(record, {
    checkpointEvery: keyframeInterval(record.endTick), captureStates: true,
  }));
});
