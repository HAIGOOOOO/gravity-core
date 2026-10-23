import type { ReplayFailure, ReplayRun } from './engine';
import { playerFromRun, type ReplayStart } from './player';
import type { ReplayRecord } from './record';

export type AsyncReplayStart = ReplayStart | Readonly<{
  ok: false; reason: 'cancelled' | 'unavailable';
}>;

/** UI用。重い検証を別スレッドへ移し、取り消しでは計算そのものを終了する。 */
export function createReplayPlayerAsync(
  record: ReplayRecord, options: { signal?: AbortSignal } = {},
): Promise<AsyncReplayStart> {
  if (options.signal?.aborted) return Promise.resolve({ ok: false, reason: 'cancelled' });
  if (typeof Worker === 'undefined') return Promise.resolve({ ok: false, reason: 'unavailable' });
  return new Promise((resolve) => {
    let worker: Worker;
    let owned: ReplayRecord;
    try {
      owned = structuredClone(record);
      worker = new Worker(new URL('./prepare.worker.ts', import.meta.url), { type: 'module' });
    }
    catch { resolve({ ok: false, reason: 'unavailable' }); return; }
    let finished = false;
    const finish = (result: AsyncReplayStart): void => {
      if (finished) return;
      finished = true;
      worker.terminate();
      options.signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = (): void => finish({ ok: false, reason: 'cancelled' });
    options.signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<ReplayRun | ReplayFailure>) => {
      try { finish(event.data.ok ? playerFromRun(owned, event.data) : event.data); }
      catch { finish({ ok: false, reason: 'unavailable' }); }
    };
    worker.onerror = (event) => { event.preventDefault(); finish({ ok: false, reason: 'unavailable' }); };
    worker.onmessageerror = () => finish({ ok: false, reason: 'unavailable' });
    try { worker.postMessage(owned); }
    catch { finish({ ok: false, reason: 'unavailable' }); }
  });
}
