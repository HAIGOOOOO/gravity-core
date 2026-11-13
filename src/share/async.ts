import type { ShareReplayResult } from './verify';

export type AsyncShareReplay = ShareReplayResult | { ok: false; reason: 'cancelled' | 'unavailable' };

/** 画面の描画を止めずに受信したコードを再計算する。中止するとWorkerも停止する。 */
export function shareToReplayAsync(text: string, signal?: AbortSignal): Promise<AsyncShareReplay> {
  if (signal?.aborted) return Promise.resolve({ ok: false, reason: 'cancelled' });
  return new Promise((resolve) => {
    let worker: Worker;
    try { worker = new Worker(new URL('./prepare.worker.ts', import.meta.url), { type: 'module' }); }
    catch { resolve({ ok: false, reason: 'unavailable' }); return; }
    const finish = (result: AsyncShareReplay): void => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      resolve(result);
    };
    const abort = (): void => finish({ ok: false, reason: 'cancelled' });
    const unavailable = (): void => finish({ ok: false, reason: 'unavailable' });
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<ShareReplayResult>) => finish(event.data);
    worker.onerror = (event) => { event.preventDefault(); unavailable(); };
    worker.onmessageerror = unavailable;
    try { worker.postMessage(text); }
    catch { unavailable(); }
  });
}
