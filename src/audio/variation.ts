/** イベント番号から再現できる微差。連続番号でも響きが少しずつ変わるよう混ぜる。 */
export function soundVariation(sequence: number): number {
  let bits = sequence | 0;
  bits = Math.imul(bits ^ (bits >>> 16), 0x45d9f3b);
  bits = Math.imul(bits ^ (bits >>> 16), 0x45d9f3b);
  return ((bits ^ (bits >>> 16)) >>> 0) / 4294967296;
}
