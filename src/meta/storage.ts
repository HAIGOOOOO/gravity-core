// meta 層で共有する「保存の口」と JSON の安全な読み書き。
// localStorage に限らず差し込めるよう、必要最小限の形だけを要求する。
// 保存が拒否・破損していても例外を投げない（保存できない端末でも遊べるようにするため）。

export type MetaStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** 保存を読んで JSON として返す。無い・壊れている・拒否されているときは null。 */
export function readStoredJson(storage: MetaStorage | null, key: string): unknown {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** 保存へ JSON で書く。拒否されても例外を投げず、呼び出し側はメモリだけで続けられる。 */
export function writeStoredJson(storage: MetaStorage | null, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // 保存できない端末ではメモリだけで続ける
  }
}

/** unknown を安全に連想配列として見る。配列や null は空オブジェクト扱い。 */
export function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
