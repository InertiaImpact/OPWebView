// Capture one pointer and paint at most once per frame. A release still commits
// its final position, even if it arrives before the scheduled frame.
export function trackPointerDrag(event, { onMove, onEnd,
  requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame }) {
  const target = event.currentTarget;
  const pointerId = event.pointerId;
  const origin = { x: event.clientX, y: event.clientY };
  let frame = null, pending = null, ended = false;
  const flush = () => {
    frame = null;
    if (!pending) return;
    const point = pending;
    pending = null;
    onMove({ dx: point.x - origin.x, dy: point.y - origin.y });
  };
  const move = (next) => {
    if (next.pointerId !== pointerId || ended) return;
    pending = { x: next.clientX, y: next.clientY };
    if (frame === null) frame = requestFrame(flush);
  };
  const finish = (next) => {
    if (ended || (next && next.pointerId !== pointerId)) return;
    ended = true;
    if (next?.type === "pointerup") pending = { x: next.clientX, y: next.clientY };
    if (frame !== null) cancelFrame(frame);
    flush();
    target.removeEventListener("pointermove", move);
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) target.removeEventListener(type, finish);
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    onEnd?.();
  };
  event.preventDefault();
  target.setPointerCapture(pointerId);
  target.addEventListener("pointermove", move);
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) target.addEventListener(type, finish);
  return () => finish();
}
