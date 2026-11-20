import type { GameEvent } from '../contracts/game';
import { makeJuiceBurst, type JuiceBurst } from '../render/juice-model';
import { juiceTimeScale } from '../render/juice-timing';
import { drawImpact } from './impact-draw';
import { impactProfile } from './impact-model';

// 停止とスローの時間は従来の演出と共通。絵は丸い点で盤面の外まで届かせる。
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
        if (active[i]!.age > impactProfile(active[i]!.burst).duration) active.splice(i, 1);
      }
    },
    draw(ctx: CanvasRenderingContext2D) {
      for (const item of active) {
        ctx.save();
        drawImpact(ctx, item.burst, item.age, reduced);
        ctx.restore();
      }
    },
    timeScale() { return active.reduce((scale, item) => Math.min(scale, juiceTimeScale(item.burst, item.age, reduced)), 1); },
    setReduced(on: boolean) { reduced = on; },
    clear() { active.length = 0; },
  };
}
