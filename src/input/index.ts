// 【仮実装】担当 B が SPEC.md 7.1〜7.4 のとおりに作り直す。
// いまは「押す・動かす・離す」の最小だけ（取り消し、2 本目の指、計算の間引きなどは未対応）。
// 関数名と引数は変えないこと。

import type { AimView, PointerInput, PointerInputDeps } from '../contracts/app';
import { AIM_MIN_RADIUS, DRAG_MIN_PX } from '../game/constants';
import { clientToLogical } from '../shared/coords';
import { dragToSpeed } from '../shared/launch';

export function createPointerInput(canvas: HTMLCanvasElement, deps: PointerInputDeps): PointerInput {
  let enabled = false;
  let active: { id: number; startX: number; startY: number; angle: number } | null = null;
  let last: AimView | null = null;

  function build(clientX: number, clientY: number): AimView {
    const a = active!;
    const dx = clientX - a.startX;
    const dy = clientY - a.startY;
    const dragPx = Math.hypot(dx, dy);
    const dirX = dragPx > 0 ? dx / dragPx : 0;
    const dirY = dragPx > 0 ? dy / dragPx : 0;
    const speed = dragToSpeed(dragPx);
    const snapshot = deps.getSnapshot();
    const prediction =
      speed === null ? null : deps.predict({ originAngleRadians: a.angle, vx: dirX * speed, vy: dirY * speed });
    return {
      originAngleRadians: a.angle,
      tier: snapshot.nextQueue[0],
      dragPx,
      dirX,
      dirY,
      speed,
      prediction,
      invalid: prediction?.rejectReason === 'overlap' || prediction?.rejectReason === 'speed',
    };
  }

  function stop(): void {
    active = null;
    last = null;
    deps.onAim(null);
  }

  function onDown(e: PointerEvent): void {
    if (!enabled || active || e.button !== 0) return;
    const p = clientToLogical(canvas, e.clientX, e.clientY);
    if (Math.hypot(p.x, p.y) < AIM_MIN_RADIUS) return;
    active = { id: e.pointerId, startX: e.clientX, startY: e.clientY, angle: Math.atan2(p.y, p.x) };
    canvas.setPointerCapture(e.pointerId);
    last = build(e.clientX, e.clientY);
    deps.onAim(last);
  }

  function onMove(e: PointerEvent): void {
    if (!active || e.pointerId !== active.id) return;
    last = build(e.clientX, e.clientY);
    deps.onAim(last);
  }

  function onUp(e: PointerEvent): void {
    if (!active || e.pointerId !== active.id) return;
    const aim = build(e.clientX, e.clientY);
    stop();
    if (aim.dragPx < DRAG_MIN_PX || aim.speed === null) {
      deps.onTapOnly();
    } else if (!aim.invalid) {
      deps.onLaunch({
        originAngleRadians: aim.originAngleRadians,
        vx: aim.dirX * aim.speed,
        vy: aim.dirY * aim.speed,
      });
    }
  }

  function onCancel(): void {
    if (active) stop();
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);

  return {
    setEnabled(on) {
      enabled = on;
      if (!on) onCancel();
    },
    cancel: onCancel,
    dispose() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
    },
  };
}
