import type { GameSnapshot, Prediction, Tier } from '../contracts/game';
import { GROW_SECONDS, LIMIT_RADIUS, TIER_RADIUS } from './constants';
import { solveContacts } from './contacts';

/** 止まった盤面で成長後の押しのけを解く目安。運動の未来や敗北を断定しない。 */
export function mergePreview(snapshot: GameSnapshot, prediction: Prediction): Prediction['mergePreview'] {
  if (!prediction.willMerge || prediction.uncertain || prediction.hitBodyId === null) return undefined;
  const target = snapshot.bodies.find((b) => b.id === prediction.hitBodyId);
  const point = prediction.points.at(-1), source = snapshot.nextQueue[0];
  if (!target || !point || source === 8 || target.tier !== source) return undefined;
  const mass = TIER_RADIUS[source] ** 2, targetMass = target.radius ** 2;
  const result = { id: -1, tier: (source + 1) as Tier,
    px: (point.x * mass + target.x * targetMass) / (mass + targetMass),
    py: (point.y * mass + target.y * targetMass) / (mass + targetMass),
    radius: TIER_RADIUS[(source + 1) as Tier], growLeft: GROW_SECONDS, touching: false, landed: true };
  const neighbors = snapshot.bodies.filter((b) => b.id !== target.id).map((b) => ({ id: b.id, tier: b.tier,
    px: b.x, py: b.y, radius: b.radius, beforeEdge: Math.hypot(b.x, b.y) + b.radius, growLeft: 0, touching: false, landed: true }));
  solveContacts([...neighbors, result]);
  const outer = (b: { px: number; py: number; radius: number }) => Math.hypot(b.px, b.py) + b.radius;
  const pushed = neighbors.filter((b) => b.beforeEdge <= LIMIT_RADIUS && outer(b) > LIMIT_RADIUS)
    .map((b) => ({ id: b.id, x: b.px, y: b.py, radius: b.radius }));
  return { x: result.px, y: result.py, radius: result.radius, tier: result.tier,
    mayCrossLimit: outer(result) > LIMIT_RADIUS || pushed.length > 0, pushed };
}
