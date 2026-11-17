import { LIMIT_RADIUS } from '../game/constants';

/** 境界を天体の内側で隠しても、どこで交わったかを実際の位置で示す。 */
export function limitIntersections(x: number, y: number, radius: number, limit = LIMIT_RADIUS) {
  const distance = Math.hypot(x, y);
  if (!distance || distance > limit + radius || distance < Math.abs(limit - radius)) return [];
  const along = (limit * limit - radius * radius + distance * distance) / (2 * distance);
  const across = Math.sqrt(Math.max(0, limit * limit - along * along));
  const baseX = x / distance * along, baseY = y / distance * along;
  if (across < 1e-8) return [{ x: baseX, y: baseY }];
  const dx = -y / distance * across, dy = x / distance * across;
  return [{ x: baseX + dx, y: baseY + dy }, { x: baseX - dx, y: baseY - dy }];
}
