export function createMapPointerGuard() {
  const contacts = new Set<number>();
  let owner: number | null = null;
  let allowed = false;
  const cancel = () => { allowed = false; owner = null; };
  return {
    begin(pointer: { pointerId: number; isPrimary: boolean; button: number }, onDrawingSurface: boolean): void {
      const empty = contacts.size === 0;
      contacts.add(pointer.pointerId);
      allowed = empty && onDrawingSurface && pointer.isPrimary && pointer.button === 0;
      owner = allowed ? pointer.pointerId : null;
    },
    end(pointerId: number, canceled = false): void {
      contacts.delete(pointerId);
      if (canceled || pointerId !== owner) cancel();
    },
    cancel,
    clear(): void { contacts.clear(); cancel(); },
    canActivate: () => allowed,
  };
}

// Track physical contacts, not compatibility mouse events synthesized after touch.
export function trackMapPointers(surface: Element, changed: (allowed: boolean) => void) {
  const guard = createMapPointerGuard();
  const window = surface.ownerDocument.defaultView;
  const document = surface.ownerDocument;
  const drawingTarget = (target: EventTarget | null) => {
    const element = target as Element | null;
    return Boolean(element && surface.contains(element) && !element.closest?.('button, [role="button"]'));
  };
  const begin = (event: PointerEvent) => {
    guard.begin(event, drawingTarget(event.target));
    changed(guard.canActivate());
  };
  const end = (event: PointerEvent) => { guard.end(event.pointerId, event.type === "pointercancel"); changed(guard.canActivate()); };
  const clear = () => { guard.clear(); changed(false); };
  const visibility = () => { if (document.hidden) clear(); };
  const activate = (event: Event) => {
    if (drawingTarget(event.target) && !guard.canActivate()) { event.preventDefault(); event.stopPropagation(); }
  };
  window?.addEventListener("pointerdown", begin, true);
  window?.addEventListener("pointerup", end, true);
  window?.addEventListener("pointercancel", end, true);
  window?.addEventListener("blur", clear);
  document.addEventListener("visibilitychange", visibility);
  surface.addEventListener("click", activate, true);
  surface.addEventListener("dblclick", activate, true);
  return {
    cancel(): void { guard.cancel(); changed(false); },
    dispose(): void {
      clear();
      window?.removeEventListener("pointerdown", begin, true);
      window?.removeEventListener("pointerup", end, true);
      window?.removeEventListener("pointercancel", end, true);
      window?.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", visibility);
      surface.removeEventListener("click", activate, true);
      surface.removeEventListener("dblclick", activate, true);
    },
  };
}
