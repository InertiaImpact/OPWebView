import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { installLayoutGesture } from "../public/src/core/layout-gesture.js";
import { DeviceDiscovery } from "../public/src/core/device-discovery.js";
import { WidgetManager } from "../public/src/widgets/widget-manager.js";
import { createPresetLayout } from "../public/src/widgets/layout-presets.js";

test("editing docks do not replace a widget's saved geometry on the first drag", () => {
  const layout = createPresetLayout("enhanced");
  const temporary = structuredClone(layout);
  temporary.speed.x = 1;
  const widgets = Object.assign(Object.create(WidgetManager.prototype), {
    layout, presentedLayout: temporary, activeLayout: "enhanced", displayMode: "full", editing: true,
    layer: { dataset: {} }, emitLayoutChange() {}
  });
  widgets.markCustom();
  assert.equal(widgets.layout.speed.x, layout.speed.x);
  assert.equal(widgets.activeLayout, "custom");
});

test("side docks replace toolbar and welcome; every app control exists exactly once", async () => {
  const page = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../public/src/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(page, /class="topbar"|id="empty-state"|id="edit-button"|id="layout-dialog"|id="widget-dialog"/);
  assert.match(page, /aria-label="Add comma by IP address"/);
  assert.match(page, /id="demo-button"[^>]*>Demo<\/button>/);
  assert.match(page, /class="floating-panel view-panel"/);
  assert.match(page, /class="floating-panel widget-panel"/);
  assert.match(app, /elements\.demo\.hidden = available/);
  const allIds = [...page.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const ids = new Set(allIds);
  assert.equal(ids.size, allIds.length);
  for (const match of app.matchAll(/\$\("#([^" ]+)"\)/g)) assert.ok(ids.has(match[1]), `#${match[1]} exists`);
});

test("long press unlocks once, not on short taps, dragging, controls, cancellation or disabled state", () => {
  const target = new EventTarget();
  let callback = null, delay = null, enabled = true, calls = 0;
  const remove = installLayoutGesture({ target, enabled: () => enabled, unlock: () => calls++,
    setTimer(fn, ms) { callback = fn; delay = ms; return 1; }, clearTimer() { callback = null; } });
  const dispatch = (type, changes = {}, blocked = false) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, "target", { value: { closest: () => blocked } });
    Object.assign(event, { pointerId: 1, clientX: 10, clientY: 10, isPrimary: true, button: 0 }, changes);
    target.dispatchEvent(event);
    return event;
  };
  dispatch("pointerdown"); assert.equal(delay, 700); callback(); assert.equal(calls, 1);
  dispatch("pointerup");
  assert.equal(dispatch("pointerdown", { pointerType: "touch" }).defaultPrevented, true);
  dispatch("pointerup");
  assert.equal(dispatch("pointerdown", { pointerType: "touch" }, true).defaultPrevented, false);
  dispatch("pointerdown"); dispatch("pointerup"); assert.equal(callback, null);
  dispatch("pointerdown"); dispatch("pointermove", { clientX: 50 }); assert.equal(callback, null);
  dispatch("pointerdown"); dispatch("pointercancel"); assert.equal(callback, null);
  dispatch("pointerdown"); dispatch("pointerleave"); assert.equal(callback, null);
  dispatch("pointerdown", {}, true); assert.equal(callback, null);
  dispatch("pointerdown", { isPrimary: false }); assert.equal(callback, null);
  dispatch("pointerdown"); enabled = false; callback(); assert.equal(calls, 1);
  enabled = true;
  assert.equal(dispatch("contextmenu").defaultPrevented, true); assert.equal(calls, 2);
  enabled = false;
  assert.equal(dispatch("contextmenu").defaultPrevented, true);
  assert.equal(calls, 2, "native menu suppressed without unlocking twice");
  assert.equal(dispatch("contextmenu", {}, true).defaultPrevented, false, "controls keep native behavior");
  remove(); dispatch("pointerdown"); assert.equal(calls, 2);
});

test("viewer takes gesture ownership before editing, but leaves video playback and panel controls intact", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  const app = await readFile(new URL("../public/src/app.js", import.meta.url), "utf8");
  assert.match(css, /#road-video\s*\{\s*pointer-events: none/);
  assert.match(css, /\.viewport \{[^}]*user-select: none[^}]*-webkit-touch-callout: none/);
  assert.match(app, /if \(document\.fullscreenElement\) await document\.exitFullscreen\(\)/);
  assert.match(app, /toggle: toggleFullscreen/);
});

test("found devices are listed before automatic connection can abort discovery", async () => {
  const discovery = new DeviceDiscovery({ getItem: () => null });
  discovery.probe = async () => true;
  const order = [], controller = new AbortController();
  discovery.addEventListener("devicefound", (event) => { assert.equal(event.detail.reachable, true); order.push("listed"); });
  await discovery.scan({ signal: controller.signal, onReachable() { order.push("connect"); controller.abort(); } });
  assert.deepEqual(order, ["listed", "connect"]);
});
