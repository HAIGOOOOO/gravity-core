import type { DotsImpact } from './dots-motion';
import { BOARD_SIZE } from '../game/constants';

const TAU = Math.PI * 2;
const WIDTH = 366;

/** 全案で同じ時間・衝撃波を使い、比較中に演出の強さが入れ替わらないようにする。 */
export function drawDotsImpact(
  ctx: CanvasRenderingContext2D,
  impact: DotsImpact,
  pitch: number,
  reduced: boolean,
  colors: readonly string[],
): void {
  const { event, age } = impact;
  const chain = event.chain ?? 1;
  const x = WIDTH / 2 + (event.x ?? 0) * WIDTH / BOARD_SIZE;
  const y = WIDTH / 2 + (event.y ?? 0) * WIDTH / BOARD_SIZE;
  if (reduced) {
    const radius = 14 + chain * 5;
    ctx.globalAlpha = age < .3 ? .5 : .25;
    ctx.fillStyle = colors[event.sourceTier ?? 0]!;
    for (let angle = 0; angle < TAU; angle += .26) {
      ctx.beginPath();
      ctx.arc(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, pitch * .38, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return;
  }
  const ringCount = 3 + chain * 2;
  for (let ring = 0; ring < ringCount; ring += 1) {
    const time = age - .065 - ring * .042;
    if (time < 0 || time > .65) continue;
    const radius = 10 + time * (490 + chain * 95);
    const count = Math.ceil(TAU * radius / pitch);
    const fade = time < .26 ? 1 : time < .45 ? .5 : .25;
    ctx.globalAlpha = fade;
    ctx.fillStyle = colors[Math.min(8, 3 + ring % 4)]!;
    for (let point = 0; point < count; point += 1) {
      const angle = TAU * point / count;
      const warped = radius + Math.sin(angle * 3 + ring * .6) * 2.2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(angle) * warped, y + Math.sin(angle) * warped,
        pitch * (ring < 2 ? .64 : .38), 0, TAU);
      ctx.fill();
    }
  }
  if (age < .8) {
    const particles = 24 + chain * 18;
    for (let index = 0; index < particles; index += 1) {
      const random = Math.sin(index * 37.53 + event.sequence * 2.6);
      const angle = TAU * index / particles + random * .13;
      const time = Math.max(0, age - .045);
      const distance = time * (95 + Math.abs(random) * (150 + chain * 50));
      const curved = angle + time * random * .5;
      ctx.fillStyle = colors[index % 3 === 0 ? 6 : event.sourceTier ?? 0]!;
      ctx.globalAlpha = age < .3 ? 1 : age < .52 ? .5 : .25;
      ctx.beginPath();
      ctx.arc(x + Math.cos(curved) * distance, y + Math.sin(curved) * distance,
        pitch * Math.max(.28, (.75 + chain * .17) * (1 - age)), 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

export function dotsCamera(impact: DotsImpact | undefined, reduced: boolean) {
  if (!impact || reduced) return { x: 0, y: 0 };
  const chain = impact.event.chain ?? 1;
  const envelope = Math.max(0, 1 - impact.age / .65);
  return {
    x: Math.sin(impact.age * 89) * envelope * (.8 + chain * .6),
    y: Math.cos(impact.age * 71) * envelope * (.6 + chain * .4),
  };
}
