import type { GameEvent, Tier } from '../contracts/game';
import { grainPose } from './grain-detail';

export type JuiceDirection = 'fracture' | 'jet' | 'echo';
export type JuiceBurst = {
  direction: JuiceDirection; x: number; y: number; tier: Tier; chain: number;
  score: number; seed: number; angle: number; supernova: boolean;
};
// 同じ部品の個数は層に数えない。20はそれぞれ別の形・情報を描く。
export const JUICE_LAYERS = [
  '吸い込む筋','圧縮する陰','白熱する芯','裂ける外殻','破れた衝撃膜',
  '鉱物の破片','溶けた滴','火の粉','接線の帯','核へ戻る塵',
  '噴き出す気流','中心に残る空洞','圧痕の刻線','走る亀裂','残煙',
  '一方向の閃光','生まれた天体','獲得点','倍率の活字','核の反射',
] as const;
export const JUICE_PEAK_LAYERS = ['連鎖の段数','重力の航跡','外周の圧縮板','画面端の反響'] as const;

export function makeJuiceBurst(event: GameEvent, direction: JuiceDirection): JuiceBurst | null {
  if (event.kind !== 'merge' && event.kind !== 'supernova') return null;
  const seed = event.sequence + event.tick * 17;
  return { direction, x: event.x ?? 0, y: event.y ?? 0, tier: event.resultTier ?? event.sourceTier ?? 0,
    chain: Math.max(1,event.chain ?? 1), score: event.scoreDelta ?? 0, seed,
    angle: grainPose(seed).angle, supernova: event.kind === 'supernova' };
}
export function juiceEnvelope(age: number, start: number, crest: number, end: number): number {
  if (age <= start || age >= end) return 0;
  return age < crest ? (age-start)/(crest-start) : 1-(age-crest)/(end-crest);
}
export function juiceDuration(burst: JuiceBurst): number {
  return (burst.direction === 'echo' ? 2.5 : 1.5) + burst.tier * 0.05 + Math.min(5,burst.chain) * 0.05;
}
