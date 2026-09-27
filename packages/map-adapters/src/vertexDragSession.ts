interface ScreenPoint { x: number; y: number }

export interface VertexDragPointer {
  pointerId: number;
  button: number;
  buttons: number;
  isPrimary: boolean;
  clientX: number;
  clientY: number;
}

/** One owned pointer previews a drag; only its release can request geometry admission. */
export function createVertexDragSession(callbacks: {
  preview: (point: ScreenPoint) => void;
  commit: (point: ScreenPoint) => void;
  cancel: () => void;
}, thresholdPixels = 3) {
  let active: { pointerId: number; start: ScreenPoint; previewing: boolean } | null = null;
  const point = (event: VertexDragPointer): ScreenPoint => ({ x: event.clientX, y: event.clientY });
  const finite = (event: VertexDragPointer): boolean => Number.isFinite(event.clientX) && Number.isFinite(event.clientY);
  function cancel(pointerId?: number): void {
    if (!active || (pointerId !== undefined && pointerId !== active.pointerId)) return;
    active = null;
    callbacks.cancel();
  }
  return {
    get activePointerId(): number | null { return active?.pointerId ?? null; },
    begin(event: VertexDragPointer): boolean {
      if (active || !event.isPrimary || event.button !== 0 || !(event.buttons & 1) || !finite(event)) return false;
      active = { pointerId: event.pointerId, start: point(event), previewing: false };
      return true;
    },
    move(event: VertexDragPointer): void {
      if (!active || event.pointerId !== active.pointerId) return;
      if (!(event.buttons & 1) || !finite(event)) return cancel();
      if (active.previewing || Math.hypot(event.clientX - active.start.x, event.clientY - active.start.y) >= thresholdPixels) {
        active.previewing = true;
        callbacks.preview(point(event));
      }
    },
    finish(event: VertexDragPointer): void {
      if (!active || event.pointerId !== active.pointerId || event.button !== 0) return;
      if (!finite(event)) return cancel();
      const distance = Math.hypot(event.clientX - active.start.x, event.clientY - active.start.y);
      active = null;
      if (distance >= thresholdPixels) callbacks.commit(point(event));
      else callbacks.cancel();
    },
    cancel,
  };
}
