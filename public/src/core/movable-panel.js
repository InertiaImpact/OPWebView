import { trackPointerDrag } from "./pointer-drag.js";

// Editor chrome positions are temporary, not part of a saved dashboard layout.
export function installPanelDrag({ panel, handle, boundsElement, enabled }) {
  let position = null, stopDrag = null;
  const bounds = () => {
    const root = boundsElement.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    return { root, rect, maxX: Math.max(0, root.width - rect.width), maxY: Math.max(0, root.height - rect.height) };
  };
  const paint = (x, y, size) => {
    position = { x: Math.max(0, Math.min(size.maxX, x)), y: Math.max(0, Math.min(size.maxY, y)) };
    panel.style.left = `${position.x}px`;
    panel.style.top = `${position.y}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  };
  const cancelDrag = () => stopDrag?.();
  const constrain = () => {
    if (panel.hidden || !position) return;
    cancelDrag();
    paint(position.x, position.y, bounds());
  };
  const start = (event) => {
    if (!enabled() || event.isPrimary === false || event.button !== 0 ||
        event.target.closest("button, input, select, textarea, a")) return;
    cancelDrag();
    const size = bounds();
    const x = size.rect.left - size.root.left, y = size.rect.top - size.root.top;
    panel.classList.add("panel-dragging");
    stopDrag = trackPointerDrag(event, {
      onMove: ({ dx, dy }) => paint(x + dx, y + dy, size),
      onEnd: () => { stopDrag = null; panel.classList.remove("panel-dragging"); }
    });
  };
  const keydown = (event) => {
    if (!enabled() || event.target !== handle) return;
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return;
    event.preventDefault();
    cancelDrag();
    const size = bounds(), step = event.shiftKey ? 40 : 10;
    paint(size.rect.left - size.root.left + direction[0] * step,
      size.rect.top - size.root.top + direction[1] * step, size);
  };
  handle.addEventListener("pointerdown", start);
  handle.addEventListener("keydown", keydown);
  const observer = new ResizeObserver(constrain);
  observer.observe(boundsElement);
  observer.observe(panel);
  return { cancelDrag, constrain, destroy() {
    cancelDrag(); observer.disconnect();
    handle.removeEventListener("pointerdown", start);
    handle.removeEventListener("keydown", keydown);
  } };
}
