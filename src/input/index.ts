// 【仮実装】担当 B が作り直す（docs/tasks/B.md）。
// いまは「押す・動かす・離す」の最小だけ（取り消し、2 本目の指、計算の間引きなどは未対応）。
// 関数名と引数は変えないこと。

import type { AimView, PointerInput, PointerInputDeps } from '../contracts/app';
import { AIM_MIN_RADIUS } from '../game/constants';
import { clientToLogical } from '../shared/coords';
import { aimVelocity } from '../shared/launch';

export function createPointerInput(canvas: HTMLCanvasElement, deps: PointerInputDeps): PointerInput {
  let enabled = false;
  let active: { id: number; startX: number; startY: number; angle: number } | null = null;

  function build(clientX: number, clientY: number): AimView {
    const a = active!;
    const dx = clientX - a.startX;
    const dy = clientY - a.startY;
    const v = aimVelocity(a.angle, dx, dy);
    const prediction = deps.predict({ originAngleRadians: a.angle, vx: v.vx, vy: v.vy });
    return {
      originAngleRadians: a.angle,
      tier: deps.getSnapshot().nextQueue[0],
      dragPx: Math.hypot(dx, dy),
      vx: v.vx,
      vy: v.vy,
      speed: v.speed,
      straight: v.straight,
      prediction,
      invalid: prediction.rejectReason === 'overlap' || prediction.rejectReason === 'speed',
    };
  }

  function stop(): void {
    active = null;
    deps.onAim(null);
  }

  function onDown(e: PointerEvent): void {
    if (!enabled || active || e.button !== 0) return;
    const p = clientToLogical(canvas, e.clientX, e.clientY);
    if (Math.hypot(p.x, p.y) < AIM_MIN_RADIUS) return;
    active = { id: e.pointerId, startX: e.clientX, startY: e.clientY, angle: Math.atan2(p.y, p.x) };
    canvas.setPointerCapture(e.pointerId);
    deps.onAim(build(e.clientX, e.clientY));
  }

  function onMove(e: PointerEvent): void {
    if (!active || e.pointerId !== active.id) return;
    deps.onAim(build(e.clientX, e.clientY));
  }

  function onUp(e: PointerEvent): void {
    if (!active || e.pointerId !== active.id) return;
    const aim = build(e.clientX, e.clientY);
    stop();
    if (!aim.invalid) deps.onLaunch({ originAngleRadians: aim.originAngleRadians, vx: aim.vx, vy: aim.vy });
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
