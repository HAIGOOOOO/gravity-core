// シード付き乱数（mulberry32）。ゲームの計算では Math.random() を使わず、必ずこれを使う。

export type Rng = () => number;

/** 0 以上 1 未満の数を返す関数を作る。同じシードなら同じ並びになる。 */
export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
