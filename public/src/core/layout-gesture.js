export function installLayoutGesture({ target, enabled, unlock,
  setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = (id) => clearTimeout(id) }) {
  let down = null, timer = null;
  const blocked = (event) => event.target.closest?.("button, input, select, textarea, a, dialog, .floating-panel, [contenteditable]");
  const reset = () => { if (timer !== null) clearTimer(timer); timer = null; down = null; };
  const onDown = (event) => {
    reset();
    if (!enabled() || blocked(event) || event.isPrimary === false || event.button > 0) return;
    down = { id: event.pointerId, x: event.clientX, y: event.clientY };
    timer = setTimer(() => { timer = null; if (down && enabled()) unlock(); down = null; }, 700);
  };
  const onMove = (event) => {
    if (down && (event.pointerId !== down.id || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 18)) reset();
  };
  const onContext = (event) => {
    if (!blocked(event) && enabled()) { event.preventDefault(); reset(); unlock(); }
    else if (!blocked(event) && target.closest?.(".app")?.classList.contains("layout-editing")) event.preventDefault();
  };
  target.addEventListener("pointerdown", onDown);
  target.addEventListener("pointermove", onMove);
  target.addEventListener("pointerup", reset);
  target.addEventListener("pointercancel", reset);
  target.addEventListener("pointerleave", reset);
  target.addEventListener("contextmenu", onContext);
  return () => {
    reset();
    target.removeEventListener("pointerdown", onDown);
    target.removeEventListener("pointermove", onMove);
    target.removeEventListener("pointerup", reset);
    target.removeEventListener("pointercancel", reset);
    target.removeEventListener("pointerleave", reset);
    target.removeEventListener("contextmenu", onContext);
  };
}
