export function installFullscreenGesture({ target, enabled, enter, now = () => performance.now() }) {
  let down = null, previous = null;
  const blocked = (event) => event.target.closest?.("button, input, select, textarea, a, dialog, [contenteditable]");
  const onDown = (event) => {
    if (!enabled() || blocked(event) || event.isPrimary === false || event.button > 0) { down = previous = null; return; }
    down = { id: event.pointerId, x: event.clientX, y: event.clientY, at: now() };
  };
  const onUp = (event) => {
    const tap = down; down = null;
    const time = now();
    if (!tap || !enabled() || blocked(event) || event.pointerId !== tap.id || time - tap.at > 300
      || Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 18) { previous = null; return; }
    if (previous && time - previous.at <= 350 && Math.hypot(tap.x - previous.x, tap.y - previous.y) <= 40) {
      previous = null;
      // Call synchronously inside the second user gesture for fullscreen's
      // activation requirement. This gesture enters fullscreen, never exits it.
      if (event.cancelable) event.preventDefault();
      enter();
    } else { previous = { x: tap.x, y: tap.y, at: time }; }
  };
  const reset = () => { down = previous = null; };
  target.addEventListener("pointerdown", onDown);
  target.addEventListener("pointerup", onUp);
  target.addEventListener("pointercancel", reset);
  return () => {
    target.removeEventListener("pointerdown", onDown);
    target.removeEventListener("pointerup", onUp);
    target.removeEventListener("pointercancel", reset);
  };
}
