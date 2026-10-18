import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { installLayoutGesture } from "../public/src/core/layout-gesture.js";
import { DeviceDiscovery } from "../public/src/core/device-discovery.js";
import { WidgetManager } from "../public/src/widgets/widget-manager.js";
import { createPresetLayout } from "../public/src/widgets/layout-presets.js";

test("compact editor uses single-row presets/save controls and a touch-sized two-column widget list", async () => {
  const css=await readFile(new URL("../public/styles.css",import.meta.url),"utf8");
  const page=await readFile(new URL("../public/index.html",import.meta.url),"utf8");
  assert.match(css,/\.view-panel \.layout-presets \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css,/\.view-panel \.save-layout-row \{ grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(css,/\.widget-panel \.widget-toggles \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css,/\.widget-panel \.widget-toggle \{ min-height: 36px/);
  assert.match(css,/@media \(max-width: 600px\) \{\s*\.widget-panel \.widget-toggles \{ grid-template-columns: 1fr/);
  assert.match(page,/class="editor-actions">\s*<button id="reset-layout-button"[\s\S]*?id="editing-devices-button"/);
  assert.match(css,/\.floating-panel\.panel-collapsed > :not\(\.dock-header\):not\(#done-editing-button\)/);
});

test("compact saved-view actions retain full accessible names and bounded visual labels", async () => {
  const app=await readFile(new URL("../public/src/app.js",import.meta.url),"utf8");
  const css=await readFile(new URL("../public/styles.css",import.meta.url),"utf8");
  assert.match(app,/use\.setAttribute\("aria-label", `Recall \$\{name\}`\)/);
  assert.match(app,/remove\.setAttribute\("aria-label", `Delete \$\{name\}`\)/);
  assert.match(app,/elements\.layoutLabel\.title = widgets\.activeLabel\(\)/);
  assert.match(css,/\.view-panel \.dock-header #layout-label \{[^}]*min-width: 0;[^}]*text-overflow: ellipsis/);
  assert.match(css,/\.view-panel \.saved-layout-row strong \{[^}]*text-overflow: ellipsis/);
});

test("one Devices control moves between the open header and collapsed pill and hides when connected", async () => {
  const app = await readFile(new URL("../public/src/app.js", import.meta.url), "utf8");
  const page = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(page, /<header class="dock-header">\s*<button id="controls-toggle"/);
  assert.match(page, /class="device-menu-icon"[^>]*aria-hidden="true"/);
  assert.doesNotMatch(css, /\.device-panel-toggle\s*\{[^}]*top:\s*46%/);
  const source = app.match(/function syncDevicePanel\(\) \{[\s\S]*?\n\}/)[0];
  const control = { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  const parent = () => ({ insertBefore(child) { child.parentElement = this; } });
  const header = parent(), root = Object.assign(parent(), { dataset: { status: "disconnected" } });
  const elements = { app: root, controlsToggle: control, devicePanel: { querySelector: () => header }, connectionPill: {} };
  for (const [open, editing, connected, visible] of [
    [true, false, false, true], [false, false, false, true],
    [true, false, false, true], [false, false, true, false],
    [true, true, true, false], [true, false, true, true]
  ]) {
    root.dataset.status = connected ? "connected" : "disconnected";
    runInNewContext(`${source}; syncDevicePanel();`, { elements, widgets: { editing }, devicePanelOpen: open });
    assert.equal(control.hidden, !visible);
    assert.equal(control.parentElement, open && !editing ? header : root);
    assert.equal(control.attributes["aria-expanded"], String(open && !editing));
    assert.equal(control.attributes["aria-label"], open && !editing ? "Collapse devices" : "Show devices");
  }
});

test("unconfirmed comma.local and saved devices stay hidden; parallel hostname checking remains", async () => {
  const app = await readFile(new URL("../public/src/app.js", import.meta.url), "utf8");
  const discovery = await readFile(new URL("../public/src/core/device-discovery.js", import.meta.url), "utf8");
  assert.match(app, /devices = devices\.filter\(\(device\) => device\.reachable === true\);\s*listedDevices = devices/);
  assert.doesNotMatch(app, /discovery\.saved\(\)/);
  assert.match(discovery, /DEFAULT_CANDIDATES = \["comma\.local"\]/);
});

test("device cards show only current verified results and keep the connected device identifiable", async () => {
  const app = await readFile(new URL("../public/src/app.js", import.meta.url), "utf8");
  const source = app.match(/function renderDevices\(devices\) \{[\s\S]*?\n\}/)[0];
  const node = () => ({ children: [], append(...items) { this.children.push(...items); }, replaceChildren() { this.children = []; }, addEventListener() {} });
  const list = node(), demo = {};
  const current = { host: "192.168.138.233", authority: "192.168.138.233:5001", reachable: true };
  const context = { document: { createElement: node }, elements: { deviceList: list, demo },
    listedDevices: [], demoActive: false, store: { state: { isConnected: true } },
    connection: { device: current, connecting: false }, stopDemo() {}, connectDevice() {} };
  runInNewContext(`${source}; renderDevices(devices);`, { ...context, devices: [
    { host: "192.168.26.233", reachable: false }, { host: "comma.local" }, current
  ] });
  assert.equal(list.children.length, 1);
  const [summary, button] = list.children[0].children;
  assert.match(summary.children[1].textContent, /found on this network/);
  assert.equal(button.textContent, "Connected"); assert.equal(button.disabled, true);
  assert.equal(demo.hidden, true);
});

test("editing menus overlay unchanged widget bounds and can collapse independently", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  const page = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../public/src/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.app\.layout-editing \.widget-layer\s*\{[^}]*(?:left|right|width):/);
  assert.match(css, /\.floating-panel\.panel-collapsed > :not\(\.dock-header\):not\(#done-editing-button\)/);
  assert.equal([...page.matchAll(/class="panel-collapse"/g)].length, 2);
  assert.match(app, /panel\.classList\.toggle\("panel-collapsed"\)/);
  assert.match(app, /!devicePanelOpen && elements\.app\.dataset\.status === "connected"/);
  assert.match(page, /id="editing-devices-button"/);
  assert.match(page, /<details class="device-tools">/);
  assert.match(app, /button\.hidden = device\.reachable !== true/);
});

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
