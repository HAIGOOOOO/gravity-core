import type { GameSnapshot } from '../contracts/game';
import type { ReplayHighlight } from '../replay/highlights';
import type { DefeatCause } from '../replay/cause';
import { createResultSample } from './replay-result-sample';
import { TICK_HZ } from '../game/constants';
import type { ReplayRecord } from '../replay/record';

export type ResultMessage =
  | { kind: 'progress'; seconds: number }
  | { kind: 'recorded'; seconds: number; snapshot: GameSnapshot }
  | { kind: 'result'; record: ReplayRecord; ms: number; highlights: readonly ReplayHighlight[]; cause: DefeatCause | null; snapshot: GameSnapshot }
  | { kind: 'error' };

let capture: ReturnType<typeof createResultSample> | null = null;
self.addEventListener('message', (event: MessageEvent<'record' | 'finish'>) => {
  try {
    if (event.data === 'record') {
      capture = createResultSample((seconds) => self.postMessage({ kind: 'progress', seconds } satisfies ResultMessage));
      const snapshot = capture.simulation.getSnapshot();
      self.postMessage({ kind: 'recorded', seconds: snapshot.tick / TICK_HZ, snapshot } satisfies ResultMessage);
    } else if (capture) {
      const began = performance.now();
      const result = capture.finish();
      self.postMessage({ kind: 'result', record: result.record, ms: performance.now() - began, highlights: result.highlights,
        cause: result.cause, snapshot: capture.simulation.getSnapshot() } satisfies ResultMessage);
    }
  } catch { self.postMessage({ kind: 'error' } satisfies ResultMessage); }
});
