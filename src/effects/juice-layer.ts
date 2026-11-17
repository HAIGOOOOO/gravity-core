import type { GameEvent } from '../contracts/game';
import { drawJuice } from '../render/juice-shapes';
import { juiceDuration, makeJuiceBurst, type JuiceBurst } from '../render/juice-model';

// 担当 D の合体の演出（案 A「裂ける」。docs/notes/D/00-juice.md）を本番の演出の層に重ねる。
// 盤面を暗くする・天体を描き直す層は見本ページだけの物なので、ここでは合体の形だけを描く。
const MAX_BURSTS = 8;

type Active = { burst: JuiceBurst; age: number };

export function createJuiceLayer() {
  const active: Active[] = [];
  let reduced = false;
  return {
    handle(event: GameEvent) {
      const burst = makeJuiceBurst(event, 'fracture');
      if (!burst) return;
      if (active.length >= MAX_BURSTS) active.shift();
      active.push({ burst, age: 0 });
    },
    update(seconds: number) {
      for (const item of active) item.age += seconds;
      for (let i = active.length - 1; i >= 0; i--) {
        if (active[i]!.age > juiceDuration(active[i]!.burst)) active.splice(i, 1);
      }
    },
    draw(ctx: CanvasRenderingContext2D) {
      for (const item of active) {
        ctx.save();
        drawJuice(ctx, item.burst, item.age, reduced);
        ctx.restore();
      }
    },
    setReduced(on: boolean) { reduced = on; },
    clear() { active.length = 0; },
  };
}
