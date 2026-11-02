import type { BodyView, GameSnapshot } from '../contracts/game';
import { BOARD_SIZE, CHAIN_WINDOW_SECONDS, DT, TIER_RADIUS } from '../game/constants';
import { juiceEnvelope, type JuiceBurst } from './juice-model';
import { juiceMatterTime } from './juice-timing';

export function juiceExposure(burst: JuiceBurst, age: number, reduced: boolean): number {
  if (reduced || (!burst.supernova && burst.chain < 5)) return 0;
  const time = age / (burst.direction === 'echo' ? 1.6 : burst.direction === 'jet' ? .82 : 1);
  return .88 * juiceEnvelope(time, .085, .10, .12);
}

/** ㊳ 広い感光は一度だけ。ガイドと天体は必ずこの後に描く。 */
export function drawJuiceExposure(ctx: CanvasRenderingContext2D, burst: JuiceBurst, age: number, reduced: boolean): void {
  const weight = juiceExposure(burst, age, reduced);
  if (weight <= 0) return;
  ctx.save(); ctx.globalAlpha *= weight; ctx.fillStyle = '#ffe3a0'; ctx.fillRect(-BOARD_SIZE/2,-BOARD_SIZE/2,BOARD_SIZE,BOARD_SIZE); ctx.restore();
}

/** ㊲ 飛び出した殻が、光を受けた近傍天体の面へ落とす影。 */
export function drawJuiceShadows(ctx: CanvasRenderingContext2D, burst: JuiceBurst, bodies: readonly BodyView[], time: number): void {
  if (burst.chain < 5 && !burst.supernova) return;
  ctx.save(); ctx.globalAlpha *= .55 * juiceEnvelope(time, .12, .2, .5); ctx.fillStyle = '#070b18';
  for (const body of bodies) {
    if (Math.hypot(body.x - burst.x, body.y - burst.y) > 300) continue;
    ctx.save(); ctx.beginPath(); ctx.arc(body.x, body.y, body.radius, 0, Math.PI * 2); ctx.clip();
    ctx.translate(body.x, body.y); ctx.rotate(Math.atan2(body.y - burst.y, body.x - burst.x));
    ctx.beginPath(); ctx.moveTo(-body.radius, -body.radius * .3);
    ctx.lineTo(body.radius, body.radius * .1); ctx.lineTo(body.radius, body.radius * .35); ctx.lineTo(-body.radius, -body.radius * .08); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** ㊴ 閃光の時点の輪郭を薄く残す。実計算中も、その後の位置へは追従させない。 */
export function drawJuiceAfterimage(ctx: CanvasRenderingContext2D, burst: JuiceBurst, bodies: readonly BodyView[], time: number): void {
  if (burst.chain < 5 && !burst.supernova) return;
  ctx.save(); ctx.globalAlpha *= .42 * juiceEnvelope(time, .12, .14, .36); ctx.strokeStyle = '#ffe3a0'; ctx.lineWidth = 2;
  for (const body of bodies) { ctx.beginPath(); ctx.arc(body.x, body.y, body.radius + 8, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
}

/** ㊵ 期限は実際のchainUntilTickから取る。見本を止めた場合だけ表示の経過を引く。 */
export function drawJuiceDeadline(ctx: CanvasRenderingContext2D, burst: JuiceBurst, body: BodyView | undefined, snapshot: GameSnapshot, age: number, live: boolean): void {
  if (!body || burst.chain < 2) return;
  const elapsed = live ? 0 : juiceMatterTime(burst, age);
  const left = Math.max(0, (body.chainUntilTick - snapshot.tick) * DT - elapsed);
  if (left <= 0) return;
  ctx.save(); ctx.strokeStyle = '#ffe3a0'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(body.x, body.y, body.radius + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, left / CHAIN_WINDOW_SECONDS)); ctx.stroke();
  ctx.restore();
}

/** ㊶㊷ 冷える量と核への流路。超新星の実際のheatDeltaがある時だけ出す。 */
export function drawJuiceCooling(ctx: CanvasRenderingContext2D, burst: JuiceBurst, time: number): void {
  if (!burst.supernova || burst.heatDelta >= 0) return;
  const weight = juiceEnvelope(time, .28, .5, 1.4);
  ctx.save(); ctx.globalAlpha *= weight; ctx.strokeStyle = '#9be4eb'; ctx.lineWidth = 12;
  ctx.beginPath(); ctx.moveTo(burst.x, burst.y);
  ctx.quadraticCurveTo(burst.x * .5 + 48, burst.y * .5, 0, 0); ctx.stroke();
  ctx.fillStyle = '#070b18'; ctx.fillRect(42, -35, 210, 58);
  ctx.fillStyle = '#9be4eb'; ctx.font = '700 30px "Yu Mincho","YuMincho",serif'; ctx.fillText(`熱量 ${burst.heatDelta}`, 50, 5);
  ctx.restore();
}

/** ㊱ 得点の活字から落ちる欠片。鉱物片とは場所・形・動く向きを分ける。 */
export function drawJuiceTypeChips(ctx: CanvasRenderingContext2D, burst: JuiceBurst, time: number): void {
  if (burst.chain < 5 && !burst.supernova) return;
  ctx.save(); ctx.globalAlpha *= juiceEnvelope(time, .22, .30, .75); ctx.fillStyle = '#ffe3a0';
  for (let i = 0; i < 7; i++) {
    const x = burst.x + 58 + i * 12, y = burst.y + TIER_RADIUS[burst.tier] + 90 + Math.max(0, time - .22) ** 2 * 190 + (i % 3) * 5;
    ctx.save(); ctx.translate(x, y); ctx.rotate((i - 3) * time * 2); ctx.fillRect(-2, -4, 4, 8); ctx.restore();
  }
  ctx.restore();
}
