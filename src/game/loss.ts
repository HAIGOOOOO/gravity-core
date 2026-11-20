import type { BodyView, LossSummary } from '../contracts/game';
import { CHAIN_GRACE_SECONDS, LIMIT_GRACE_SECONDS, LIMIT_RADIUS, LOSS_NEAR_FUSION_GAP, LOSS_NEAR_FUSION_MIN_TIER, TICK_HZ } from './constants';

type Source = BodyView & { landed: boolean; growLeft: number };

/** 熱上昇に参加していた天体のうち、外縁が最も遠い1体を代表にする。同距離は小さいID。 */
export function lossFromOverflow(bodies: readonly Source[], tick: number): Extract<LossSummary, { kind: 'overLimit' }> | null {
  let culprit: Source | null = null, edge = -Infinity;
  for (const body of bodies) {
    if (!body.overLimit) continue;
    const outer = Math.hypot(body.x, body.y) + body.radius;
    if (outer > edge || (outer === edge && body.id < culprit!.id)) { culprit = body; edge = outer; }
  }
  if (!culprit) return null;
  let near: Source | null = null, gap = Infinity, chain = 0;
  const mature = (b: Source) => b.landed && b.growLeft === 0 && tick - b.bornTick >= Math.round(LIMIT_GRACE_SECONDS * TICK_HZ);
  if (culprit.tier >= LOSS_NEAR_FUSION_MIN_TIER && mature(culprit)) for (const body of bodies) {
    if (body.id === culprit.id || body.tier !== culprit.tier || !mature(body)) continue;
    const stage = Math.max(tick + 1 <= culprit.chainUntilTick + Math.round(CHAIN_GRACE_SECONDS * TICK_HZ) ? culprit.chain : 0,
      tick + 1 <= body.chainUntilTick + Math.round(CHAIN_GRACE_SECONDS * TICK_HZ) ? body.chain : 0);
    if (stage === 0) continue;
    const distance = Math.max(0, Math.hypot(body.x - culprit.x, body.y - culprit.y) - body.radius - culprit.radius);
    if (distance <= LOSS_NEAR_FUSION_GAP && (distance < gap || (distance === gap && body.id < near!.id))) { near = body; gap = distance; chain = stage + 1; }
  }
  const { id, tier, x, y, radius } = culprit;
  return { kind: 'overLimit', tick, culprit: { id, tier, x, y, radius }, overflowPx: Math.max(0, edge - LIMIT_RADIUS),
    ...(near ? { nearFusion: { bodyIds: [id, near.id] as const, tier, gapPx: gap, chain } } : {}) };
}

export function copyLoss(loss: LossSummary): LossSummary {
  return loss.kind === 'overLimit' ? { ...loss, culprit: { ...loss.culprit },
    ...(loss.nearFusion ? { nearFusion: { ...loss.nearFusion, bodyIds: [loss.nearFusion.bodyIds[0], loss.nearFusion.bodyIds[1]] } } : {}) } : { ...loss };
}
