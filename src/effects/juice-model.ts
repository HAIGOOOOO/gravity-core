import type { BodyView, GameEvent, Tier } from '../contracts/game';
import { TIER_RADIUS } from '../game/constants';

export const JUICE_CAP = 8;
export const LAYER_NAMES = [
  '吸着する二体の残像', '内へ落ちる光の雨', '圧縮する重力格子', '点火前の暗い輪郭',
  '表面を走る割れ目', '白い縁の点火', '片側へ開く光の膜', '外へ走る圧力波',
  '歪んだ衝撃の面', '接線方向の光の刃', '回転する岩の破片', '核へ曲がる火の粉',
  '巻き付くプラズマ', '遅れて広がる煙', '捕まる塵の軌道', '消えた天体の輪郭',
  '誕生する天体の弾み', '表面の二次振動', '得点の打ち出し', '得点の飛行と尾',
  '得点の到着反動', '核のコロナへの応答',
  '合体間を結ぶ放電', '連鎖倍率の分裂と着地', '接続線を走る光点', '色のずれた衝撃の影',
  '局所空間のひだ', '背景を落とす窓', '核へ巻き込む星', '限界リング手前の波',
  '不揃いに割れる厚い殻', '残光を留める軌道結び', '盤面を横断する光の扇', '周囲の天体へ伝わる重力波',
  '衝撃方向の稲妻', '縦に裂ける放射柱', '破片の破裂光', '盤面の縁の反射',
  '反転する明暗の輪郭', '最大連鎖の巨大な倍率', '核へつながる引力の面', '爆心へ戻る尾',
  '向きのあるカメラ反動', '溜めとヒットストップと解放',
] as const;
// 見えない時期の図形まで描かず、短い層を次の層へ渡す。
export const LAYER_ENDS = [.11, .19, .22, .23, .195, .195, .39, .775, .51, .435, .775, .775, .775, 1.05, .98, .40, .42, .64, .32, .97, 1.24, .63,
  .48, .82, .775, .30, .53, .465, .775, .77, .56, 1.1, .7, 1.04, .29, .39, .45, .68, .25, 1, .69, 1.15] as const;

export type JuiceBurst = {
  active: boolean; age: number; x: number; y: number; px: number; py: number;
  tier: Tier; result: Tier; chain: number; nova: boolean; seed: number; score: number;
  neighbors: readonly BodyView[];
};
export function blankBurst(): JuiceBurst {
  return { active: false, age: 0, x: 0, y: 0, px: 0, py: 0, tier: 0, result: 1, chain: 1, nova: false, seed: 0, score: 0, neighbors: [] };
}
export function juiceRandom(seed: number, index: number): number {
  let n = Math.imul(seed ^ (index * 374761393), 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
export function layerCount(chain: number, nova = false): number {
  return nova || chain >= 5 ? 44 : [22, 27, 32, 37][Math.max(0, Math.min(3, chain - 1))];
}
export function burstRadius(b: JuiceBurst): number { return Math.max(72, TIER_RADIUS[b.result] * 1.6) * (1 + (b.chain - 1) * 0.12); }
/** 同じ拡大ではなく、大きい出来事だけ圧縮を長く読ませる。秒は実時間。 */
export function releaseTime(b: Pick<JuiceBurst, 'chain' | 'tier' | 'nova'>): number {
  return b.nova ? 0.18 : Math.max([0.065, 0.075, 0.10, 0.125, 0.16][Math.max(0, Math.min(4, b.chain - 1))], b.tier >= 6 ? 0.14 : 0);
}
export function visualAge(b: JuiceBurst): number {
  const release = releaseTime(b);
  return b.age < release ? b.age / release * 0.075 : 0.075 + b.age - release;
}
export function burstLife(b: JuiceBurst): number { return (b.nova ? 2.4 : 1.25 + b.chain * 0.1 + b.tier * 0.035) + releaseTime(b) - 0.075; }
export function burstFromEvent(event: GameEvent, previous: { x: number; y: number }): JuiceBurst {
  return { active: true, age: 0, x: event.x ?? 0, y: event.y ?? 0, px: previous.x, py: previous.y,
    tier: event.sourceTier ?? 0, result: event.resultTier ?? event.sourceTier ?? 0,
    chain: Math.max(1, Math.min(5, event.chain ?? 1)), nova: event.kind === 'supernova',
    seed: event.sequence, score: event.scoreDelta ?? 0, neighbors: [] };
}
export function pulse(t: number, start: number, duration: number): number {
  const p = (t - start) / duration;
  return p < 0 || p > 1 ? 0 : Math.sin(Math.PI * p);
}
export function releaseProgress(t: number, start = 0.075, duration = 0.7): number {
  return Math.max(0, Math.min(1, (t - start) / duration));
}
export function juiceTimeScale(b: JuiceBurst, reduced = false): number {
  if (reduced || !b.active) return 1;
  const stop = b.nova ? 0.067 : b.chain >= 5 ? 0.05 : b.chain >= 3 || b.tier >= 3 ? 0.025 : 0;
  const at = releaseTime(b) - 0.04;
  if (b.age >= at && b.age < at + stop) return 0;
  if ((b.nova || b.chain >= 3) && b.age >= at + stop && b.age < releaseTime(b) + 0.18) return 0.35;
  return 1;
}
