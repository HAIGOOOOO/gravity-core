import type { GameSnapshot } from '../contracts/game';
import { TICK_HZ } from '../game/constants';
import { createAutoPlay } from '../fixtures';
import { createReplayRecord, type ReplayRecord } from '../replay';
import { createRunRecorder, type RunDetailV1 } from '../storage';

export type RecordSample = Readonly<{
  snapshot: GameSnapshot;
  detail: RunDetailV1;
  record: ReplayRecord;
}>;

self.onmessage = (event: MessageEvent<30 | 120>) => {
  const auto = createAutoPlay(7);
  const recorder = createRunRecorder();
  for (let tick = 0; tick < event.data * TICK_HZ && auto.sim.getSnapshot().phase === 'active'; tick++) {
    recorder.feed(auto.step());
  }
  const snapshot = auto.sim.getSnapshot();
  const detail = recorder.finish(snapshot, {
    id: `sample-${event.data}`,
    playedAt: new Date().toISOString(),
    gameVersion: 'records-demo',
  });
  self.postMessage({ snapshot, detail, record: createReplayRecord(auto.sim) } satisfies RecordSample);
};
