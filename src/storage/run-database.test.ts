import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRunDatabase, RUN_DATABASE_OPEN_TIMEOUT_MS, isRunDatabaseOpenError } from './run-database';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function pendingOpen() {
  const close = vi.fn();
  const request = { result: { close, objectStoreNames: { contains: () => true } }, error: new Error('open failed'),
    onsuccess: null as (() => void) | null, onerror: null as (() => void) | null, onblocked: null as (() => void) | null };
  vi.stubGlobal('indexedDB', { open: vi.fn(() => request) });
  return { request, close };
}
describe('記録DBを開く失敗を区別する', () => {
  it.each(['read', 'update'] as const)('%sは無応答でも3秒でopen errorになり、遅い成功を閉じる', async (method) => {
    vi.useFakeTimers(); const { request, close } = pendingOpen();
    const db = createRunDatabase(`timeout-${method}`);
    let settled = false;
    const result = (method === 'read' ? db.read() : db.update(() => ({ result: true })))
      .then(() => { settled = true; return null; }, error => { settled = true; return error as unknown; });
    expect(RUN_DATABASE_OPEN_TIMEOUT_MS).toBe(3000);
    await vi.advanceTimersByTimeAsync(2999); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(isRunDatabaseOpenError(await result)).toBe(true);
    request.onsuccess?.(); expect(close).toHaveBeenCalledOnce();
  });
  it.each(['throw', 'error', 'blocked'] as const)('%sはopen errorとして拒否する', async (failure) => {
    const { request } = pendingOpen();
    if (failure === 'throw') vi.stubGlobal('indexedDB', { open() { throw new Error('unavailable'); } });
    const result = createRunDatabase(failure).read().catch(error => error as unknown);
    if (failure === 'error') request.onerror?.();
    if (failure === 'blocked') request.onblocked?.();
    expect(isRunDatabaseOpenError(await result)).toBe(true);
  });
  it('開けた後のtransaction失敗はopen errorにしない', async () => {
    const { request } = pendingOpen();
    const failure = new Error('transaction denied');
    Object.assign(request.result, { transaction() { throw failure; } });
    const result = createRunDatabase('transaction').read().catch(error => error as unknown);
    request.onsuccess?.();
    expect(await result).toBe(failure);
    expect(isRunDatabaseOpenError(await result)).toBe(false);
  });
});
