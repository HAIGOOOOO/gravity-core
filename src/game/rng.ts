// シード付き乱数（mulberry32）。ゲームの計算では Math.random() を使わず、必ずこれを使う。

/** 0 以上 1 未満の数を返す関数。state() で今の内部状態を読める（途中の盤面の書き出し用）。 */
export type Rng = (() => number) & { state(): number };

/** 0 以上 1 未満の数を返す関数を作る。同じシードなら同じ並びになる。 */
export function createRng(seed: number): Rng {
  return createRngFromState(seed >>> 0);
}

/** rng.state() で読んだ値から、続きの並びを出す関数を作り直す。 */
export function createRngFromState(state: number): Rng {
  let s = state | 0;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Object.assign(next, { state: () => s });
}
