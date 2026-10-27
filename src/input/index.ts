// 押す・動かす・離す間の照準を扱う。山が動く時は指が止まっていても予測を更新する。
// 関数名と引数は変えないこと。

import type { AimView, PointerInput, PointerInputDeps } from '../contracts/app';
import { AIM_MIN_RADIUS } from '../game/constants';
import { clientToLogical } from '../shared/coords';
import { aimVelocity } from '../shared/launch';

export function createPointerInput(canvas: HTMLCanvasElement, deps: PointerInputDeps): PointerInput {
  let enabled = false;
  let active: { id: number; startX: number; startY: number; angle: number } | null = null;
  let aimFrame = 0, latestX = 0, latestY = 0;
  let aimDirty = false, predictedTick = -1;

  function refreshAim(): void {
    aimFrame = 0;
    if (!active) return;
    const tick = deps.getSnapshot().tick;
    if (aimDirty || tick !== predictedTick) {
      aimDirty = false; predictedTick = tick;
      deps.onAim(build(latestX, latestY));
    }
    if (active) aimFrame = requestAnimationFrame(refreshAim);
  }

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
    cancelAnimationFrame(aimFrame); aimFrame = 0;
    active = null;
    deps.onAim(null);
  }

  function onDown(e: PointerEvent): void {
    if (!enabled || active || e.button !== 0) return;
    const p = clientToLogical(canvas, e.clientX, e.clientY);
    if (Math.hypot(p.x, p.y) < AIM_MIN_RADIUS) return;
    active = { id: e.pointerId, startX: e.clientX, startY: e.clientY, angle: Math.atan2(p.y, p.x) };
    latestX = e.clientX; latestY = e.clientY; aimDirty = false; predictedTick = deps.getSnapshot().tick;
    canvas.setPointerCapture(e.pointerId);
    deps.onAim(build(e.clientX, e.clientY));
    if (active) aimFrame = requestAnimationFrame(refreshAim);
  }

  function onMove(e: PointerEvent): void {
    if (!active || e.pointerId !== active.id) return;
    latestX = e.clientX; latestY = e.clientY;
    // 移動と盤面の進行を同じ一描画へまとめる。停止中は移動した時だけ計算する。
    aimDirty = true;
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
      enabled = false;
      onCancel();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
    },
  };
}
