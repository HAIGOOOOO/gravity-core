import { afterEach, describe, expect, it, vi } from 'vitest';
import { withRunJournalLock } from './run-journal-lock';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('予備の保存口を待ち続けない', () => {
  it('Web Locksが無い環境でも保存を試し、UUID追記を使える', async () => {
    vi.stubGlobal('navigator', {});
    const work = vi.fn(() => 'saved'), unsaved = vi.fn(() => 'unsaved');
    expect(await withRunJournalLock('fallback', work, unsaved)).toBe('saved');
    expect(work).toHaveBeenCalledOnce(); expect(unsaved).not.toHaveBeenCalled();
  });
  it('待機が3秒を超えたら未保存で返し、遅れて来た実行権では書かない', async () => {
    vi.useFakeTimers();
    let late: (() => unknown) | undefined;
    let signal: AbortSignal | undefined;
    vi.stubGlobal('navigator', { locks: { request(_name: string, options: { signal: AbortSignal }, callback: () => unknown) {
      late = callback; signal = options.signal; return new Promise(() => {});
    } } });
    const work = vi.fn(() => 'saved'), unsaved = vi.fn(() => 'unsaved');
    const result = withRunJournalLock('fallback', work, unsaved);
    await vi.advanceTimersByTimeAsync(2999); expect(unsaved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(await result).toBe('unsaved');
    expect(signal?.aborted).toBe(true); late?.();
    expect(work).not.toHaveBeenCalled(); expect(unsaved).toHaveBeenCalledOnce();
  });
  it('待機の拒否は原本へ書かず未保存とし、待機用の時計も残さない', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { locks: { request: () => Promise.reject(new Error('denied')) } });
    const work = vi.fn(() => 'saved'), unsaved = vi.fn(() => 'unsaved');
    expect(await withRunJournalLock('fallback', work, unsaved)).toBe('unsaved');
    expect(work).not.toHaveBeenCalled(); expect(unsaved).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
