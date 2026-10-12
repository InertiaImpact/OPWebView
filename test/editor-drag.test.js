import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { trackPointerDrag } from "../public/src/core/pointer-drag.js";
import { installPanelDrag } from "../public/src/core/movable-panel.js";
import { WidgetManager } from "../public/src/widgets/widget-manager.js";

class Target extends EventTarget {
  constructor() {
    super(); this.style = {}; this.captured = null;
    this.classList = { add() {}, remove() {} };
  }
  setPointerCapture(id) { this.captured = id; }
  hasPointerCapture(id) { return this.captured === id; }
  releasePointerCapture() { this.captured = null; }
}
const down = (target, changes = {}) => ({ currentTarget: target, target: { closest: () => null },
  pointerId: 1, isPrimary: true, button: 0, clientX: 100, clientY: 100,
  preventDefault() {}, stopPropagation() {}, ...changes });
function send(target, type, changes = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId: 1, clientX: 100, clientY: 100 }, changes);
  target.dispatchEvent(event);
}
function frames() {
  let next = 0;
  const pending = new Map();
  return { pending, requestFrame(fn) { pending.set(++next, fn); return next; },
    cancelFrame(id) { pending.delete(id); }, tick() {
      const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach((fn) => fn());
    } };
}

test("captured drag batches movement and commits the final release, ignoring other pointers", () => {
  const target = new Target(), raf = frames(), moves = [];
  let saves = 0;
  trackPointerDrag(down(target), { ...raf, onMove: (point) => moves.push(point), onEnd: () => saves++ });
  assert.equal(target.captured, 1);
  send(target, "pointermove", { clientX: 130 });
  send(target, "pointermove", { clientX: 400 });
  send(target, "pointermove", { pointerId: 2, clientX: 900 });
  send(target, "pointerup", { pointerId: 2 });
  assert.equal(raf.pending.size, 1);
  assert.equal(moves.length, 0); assert.equal(saves, 0);
  raf.tick(); assert.deepEqual(moves, [{ dx: 300, dy: 0 }]);
  send(target, "pointermove", { clientX: 450 });
  send(target, "pointerup", { clientX: 500, clientY: 250 });
  assert.deepEqual(moves.at(-1), { dx: 400, dy: 150 });
  assert.equal(raf.pending.size, 0); assert.equal(saves, 1); assert.equal(target.captured, null);
  send(target, "lostpointercapture"); send(target, "pointermove"); raf.tick();
  assert.equal(saves, 1); assert.equal(moves.length, 2);
});

test("cancel, lost capture and explicit cleanup preserve the last point and finish exactly once", () => {
  for (const ending of ["pointercancel", "lostpointercapture", "cleanup"]) {
    const target = new Target(), raf = frames(), moves = [];
    let saves = 0;
    const stop = trackPointerDrag(down(target), { ...raf, onMove: (p) => moves.push(p), onEnd: () => saves++ });
    send(target, "pointermove", { clientX: 600 });
    if (ending === "cleanup") stop(); else send(target, ending, { clientX: 0 });
    stop(); raf.tick();
    assert.deepEqual(moves, [{ dx: 500, dy: 0 }]); assert.equal(saves, 1);
  }
});

function withBrowserGlobals(run) {
  const previous = { requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame, ResizeObserver: globalThis.ResizeObserver };
  const raf = frames(), observers = [];
  globalThis.requestAnimationFrame = raf.requestFrame;
  globalThis.cancelAnimationFrame = raf.cancelFrame;
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {} disconnect() {}
  };
  try { run(raf, observers); } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
}

test("widget dragging stays smooth over long moves without per-event layout reads or saves", () => withBrowserGlobals((raf) => {
  const target = new Target();
  let reads = 0, saves = 0, paints = 0;
  const widgets = Object.assign(Object.create(WidgetManager.prototype), {
    editing: true, displayMode: "full", layout: { speed: { x: 10, y: 10, w: 20, h: 20 } },
    layer: { getBoundingClientRect() { reads++; return { width: 1000, height: 500 }; } },
    markCustom() {}, applyLayout() { paints++; }, save() { saves++; }
  });
  widgets.startDrag(down(target), "speed");
  for (const clientX of [101, 105, 201, 300]) send(target, "pointermove", { clientX });
  raf.tick(); assert.equal(widgets.layout.speed.x, 30);
  send(target, "pointermove", { clientX: 301 }); raf.tick();
  assert.equal(widgets.layout.speed.x, 30.1, "does not quantize movement to half-percent steps");
  send(target, "pointerup", { clientX: 700, clientY: 250 });
  assert.equal(widgets.layout.speed.x, 70); assert.equal(widgets.layout.speed.y, 40);
  assert.equal(reads, 1); assert.equal(paints, 3); assert.equal(saves, 1); assert.equal(widgets.stopDrag, null);
  widgets.startDrag(down(target), "speed");
  send(target, "pointerup", { clientX: 3000, clientY: -1000 });
  assert.equal(widgets.layout.speed.x, 80); assert.equal(widgets.layout.speed.y, 0);
}));

test("resize keeps its final dimensions and rejects non-primary, right-button and zero-size drags", () => withBrowserGlobals(() => {
  const target = new Target(); let saves = 0, reads = 0;
  const widgets = Object.assign(Object.create(WidgetManager.prototype), {
    editing: true, displayMode: "full", layout: { speed: { x: 10, y: 10, w: 20, h: 20 } },
    layer: { getBoundingClientRect() { reads++; return { width: 1000, height: 500 }; } },
    markCustom() {}, applyLayout() {}, save() { saves++; }
  });
  widgets.startDrag(down(target, { isPrimary: false }), "speed");
  widgets.startResize(down(target, { button: 2 }), "speed"); assert.equal(reads, 0);
  widgets.startResize(down(target), "speed");
  send(target, "pointerup", { clientX: 333, clientY: 221 });
  assert.equal(widgets.layout.speed.w, 43.3); assert.equal(widgets.layout.speed.h, 44.2);
  assert.equal(saves, 1); assert.equal(reads, 1);
  widgets.layer.getBoundingClientRect = () => ({ width: 0, height: 0 });
  widgets.startDrag(down(target), "speed"); assert.equal(target.captured, null);
}));

test("leaving editing finishes and saves a pending drag without later pointer updates", () => withBrowserGlobals((raf) => {
  const target = new Target(); let saves = 0;
  const widgets = Object.assign(Object.create(WidgetManager.prototype), {
    editing: true, displayMode: "full", activeLayout: "custom",
    layout: { speed: { x: 10, y: 10, w: 20, h: 20 } }, elements: new Map(),
    layer: { getBoundingClientRect: () => ({ width: 1000, height: 500 }), classList: { toggle() {} } },
    markCustom() {}, applyLayout() {}, save() { saves++; }, render() {}, dispatchEvent() {}
  });
  widgets.startDrag(down(target), "speed");
  send(target, "pointermove", { clientX: 500 });
  widgets.setEditing(false);
  assert.equal(widgets.layout.speed.x, 50); assert.equal(saves, 1);
  send(target, "pointermove", { clientX: 900 }); raf.tick();
  assert.equal(widgets.layout.speed.x, 50); assert.equal(target.captured, null);
}));

test("editing menus drag by headers, retain controls and scrolling, and stay reachable on resize", () => withBrowserGlobals((raf, observers) => {
  const panel = new Target(), handle = new Target();
  let width = 1000, height = 600, panelWidth = 250, panelHeight = 400, enabled = true;
  const root = { getBoundingClientRect: () => ({ left: 0, top: 0, width, height }) };
  panel.getBoundingClientRect = () => ({ left: parseFloat(panel.style.left || 12), top: parseFloat(panel.style.top || 16), width: panelWidth, height: panelHeight });
  const controller = installPanelDrag({ panel, handle, boundsElement: root, enabled: () => enabled });
  const press = (blocked = false) => {
    const event = new Event("pointerdown", { cancelable: true });
    Object.assign(event, { pointerId: 1, isPrimary: true, button: 0, clientX: 100, clientY: 100 });
    Object.defineProperty(event, "target", { value: { closest: () => blocked } });
    handle.dispatchEvent(event);
  };
  press(true); assert.equal(handle.captured, null, "collapse button retains its own interaction");
  press(); send(handle, "pointermove", { clientX: 500, clientY: 200 }); raf.tick();
  assert.equal(panel.style.left, "412px"); assert.equal(panel.style.top, "116px");
  send(handle, "pointerup", { clientX: 3000, clientY: 3000 });
  assert.equal(panel.style.left, "750px"); assert.equal(panel.style.top, "200px");
  assert.equal(panel.style.right, "auto");
  width = 500; height = 450; observers[0].callback();
  assert.equal(panel.style.left, "250px"); assert.equal(panel.style.top, "50px");
  panelWidth = 120; panelHeight = 80; observers[0].callback();
  send(handle, "keydown", { key: "ArrowRight", shiftKey: true });
  assert.equal(panel.style.left, "290px", "focused header supports keyboard movement");
  panelWidth = 250; panelHeight = 400; observers[0].callback();
  assert.equal(panel.style.left, "250px", "expanded menu remains inside the viewport");
  enabled = false; press(); assert.equal(handle.captured, null);
  controller.destroy(); enabled = true; press(); assert.equal(handle.captured, null);
}));

test("touch ownership is limited to drag handles; both menus expose draggable headers", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  const page = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(css, /\.widget-edit-bar, \.widget-resize, \.panel-drag-handle \{ touch-action: none/);
  assert.match(css, /\.detail-panel \{[^}]*touch-action: manipulation/);
  assert.equal([...page.matchAll(/class="dock-header panel-drag-handle" tabindex="0"/g)].length, 2);
});
