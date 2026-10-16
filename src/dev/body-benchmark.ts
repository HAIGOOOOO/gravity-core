import { drawBody } from '../render/bodies';
import { TIER_RADIUS } from '../game/constants';

export async function measureSmallBodies(canvas: HTMLCanvasElement): Promise<string> {
  const ctx = canvas.getContext('2d')!;
  const samples: number[] = [];
  for (let frame = 0; frame < 1120; frame++) {
    // 一つのタスクへ1000コマを詰め込まず、実際の表示の区切りで測る。
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const start = performance.now();
    ctx.fillStyle = '#070b18'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < 80; i++) drawBody(ctx, 0, 32 + i % 10 * 64, 30 + Math.floor(i / 10) * 60, TIER_RADIUS[0], { seed: i, timeSeconds: frame / 60 });
    if (frame >= 120) samples.push(performance.now() - start);
  }
  samples.sort((a,b) => a-b);
  const exceeded = samples.filter(value => value > 4).length;
  return `小粒子A・80体・1000コマ：中央値 ${samples[500]!.toFixed(2)}ms / 95% ${samples[949]!.toFixed(2)}ms / 最大 ${samples.at(-1)!.toFixed(2)}ms / 4ms超過 ${exceeded}回（${(exceeded / samples.length * 100).toFixed(1)}%）。CPUのCanvas命令発行時間。`;
}
