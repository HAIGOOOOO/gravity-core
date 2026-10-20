import { CONTACT_SLOP, CORE_RADIUS, SOLVER_ITERATIONS } from './constants';

type ContactBody = {
  id: number; radius: number; px: number; py: number;
  growLeft: number; touching: boolean; landed: boolean;
};

/** 成長による押しのけは位置だけに反映し、山を飛ばす速度に変えない。 */
export function solveContacts(bodies: readonly ContactBody[]): ReadonlySet<number> {
  const affected = new Set(bodies.filter((b) => b.growLeft > 0).map((b) => b.id));
  const growth = new Set<number>();
  function add(b: ContactBody): void { if (b.landed) growth.add(b.id); }
  for (let it = 0; it < SOLVER_ITERATIONS; it++) {
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i]!;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j]!;
        const dx = b.px - a.px, dy = b.py - a.py;
        const reach = a.radius + b.radius, d2 = dx * dx + dy * dy;
        if (d2 >= (reach + CONTACT_SLOP) * (reach + CONTACT_SLOP)) continue;
        a.touching = true; b.touching = true;
        if (d2 >= reach * reach) continue;
        const d = Math.sqrt(d2) || 1e-6, overlap = reach - d;
        const wa = 1 / (a.radius * a.radius), wb = 1 / (b.radius * b.radius);
        const nx = dx / d, ny = dy / d;
        const ax = (nx * overlap * wa) / (wa + wb), ay = (ny * overlap * wa) / (wa + wb);
        const bx = (nx * overlap * wb) / (wa + wb), by = (ny * overlap * wb) / (wa + wb);
        a.px -= ax; a.py -= ay; b.px += bx; b.py += by;
        // 押された先の山にも伝播する。射出中の天体の衝突速度は保持する。
        if (affected.has(a.id) || affected.has(b.id)) {
          affected.add(a.id); affected.add(b.id);
          add(a); add(b);
        }
      }
    }
    for (const b of bodies) {
      const r = Math.hypot(b.px, b.py), min = CORE_RADIUS + b.radius;
      if (r < min + CONTACT_SLOP) b.touching = true;
      if (r < min) {
        const k = r > 1e-6 ? min / r : 0;
        if (k === 0) b.py = -min;
        else { b.px *= k; b.py *= k; }
        if (affected.has(b.id)) add(b);
      }
    }
  }
  return growth;
}
