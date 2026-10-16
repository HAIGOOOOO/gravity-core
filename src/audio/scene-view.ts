import { drawBody } from '../render/bodies';
import { GROW_SECONDS } from '../game/constants';
import type { SoundScene } from './directions';

/** 比較室の場面図。全案で同じ動きを使い、ゲーム状態は変更しない。 */
export function paintSoundScene(canvas: HTMLCanvasElement, scene: SoundScene, seconds: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t = reduced ? 1 : Math.max(0, seconds);
  const center = canvas.width / 2;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#101824'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#566a7b'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(center, 100, 125, 62, 0, 0, Math.PI * 2); ctx.stroke();
  if (scene === 'drop') {
    drawBody(ctx, 0, center, 35 + Math.min(1, t / 0.45) * 80, 13);
    ctx.fillStyle = '#67889b'; ctx.fillRect(center - 1, 40, 2, Math.min(65, t * 140));
  } else if (scene === 'impact') {
    drawBody(ctx, 5, center, 116, 27);
    drawBody(ctx, 0, center, 75 - (t < 0.24 ? Math.sin(t / 0.24 * Math.PI) * 10 : 0), 13);
  } else if (scene === 'small' || scene === 'large') {
    const radius = scene === 'large' ? 27 : 14;
    const tier = scene === 'large' ? 6 : 0;
    const progress = Math.min(1, t / GROW_SECONDS);
    if (progress < 1) {
      drawBody(ctx, tier, center - radius * (1 - progress), 99, radius * (1 - progress * 0.7));
      drawBody(ctx, tier, center + radius * (1 - progress), 99, radius * (1 - progress * 0.7));
    }
    drawBody(ctx, scene === 'large' ? 7 : 1, center, 99, radius * 1.25 * progress);
  } else {
    drawBody(ctx, 6, center + 119, 91, 25);
    ctx.strokeStyle = '#ff8b83'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(center, 100, 125, 62, 0, 0, Math.PI * 2); ctx.stroke();
    if (scene === 'ending') {
      ctx.fillStyle = `rgba(11,17,27,${Math.min(0.7, t * 1.1)})`; ctx.fillRect(0, 20, canvas.width, 145);
      ctx.fillStyle = '#ffaaa0'; ctx.font = '18px system-ui'; ctx.textAlign = 'center'; ctx.fillText('核熱量 100 — 終了', center, 104); ctx.textAlign = 'left';
    }
  }
  ctx.fillStyle = '#bccdd9'; ctx.font = '12px system-ui'; ctx.fillText('場面図（実プレイではありません）', 12, 18);
}
