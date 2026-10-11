import test from "node:test";
import assert from "node:assert/strict";
import { browserStorage, readStored, writeStored } from "../public/src/core/storage.js";
import { DeviceDiscovery } from "../public/src/core/device-discovery.js";
import { DiagnosticLog } from "../public/src/core/diagnostic-log.js";
import { WidgetManager } from "../public/src/widgets/widget-manager.js";
import { createPresetLayout, normalizeLayout } from "../public/src/widgets/layout-presets.js";

function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) };
}
const manager = (saved) => Object.assign(Object.create(WidgetManager.prototype), { storage: saved });
const encode = JSON.stringify;

test("malformed storage is discarded by key without touching other settings", () => {
  const saved = storage({ broken: "{", keep: "offline/layout data" });
  assert.equal(readStored(saved, "broken", "default", (v) => v), "default");
  assert.equal(saved.data.has("broken"), false);
  assert.equal(saved.data.get("keep"), "offline/layout data");
  writeStored(saved, "ok", { version: 1 });
  assert.deepEqual(readStored(saved, "ok", null, (v) => v), { version: 1 });
});

test("blocked storage and quota errors never prevent device connection or layout operations", () => {
  const blocked = { getItem() { throw new Error("Blocked"); }, setItem() { throw new Error("Quota"); }, removeItem() { throw new Error("Blocked"); } };
  assert.deepEqual(new DeviceDiscovery(blocked).saved(), []);
  assert.doesNotThrow(() => new DeviceDiscovery(blocked).remember("192.168.1.5"));
  assert.doesNotThrow(() => new DeviceDiscovery(blocked).forget("192.168.1.5:5001"));
  const widgets = manager(blocked);
  Object.assign(widgets, widgets.loadLayout());
  assert.equal(widgets.activeLayout, "classic");
  assert.doesNotThrow(() => widgets.save());
  assert.deepEqual(widgets.namedLayouts(), {});
  assert.doesNotThrow(() => new DiagnosticLog(blocked).add("info", "test", "still running"));
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
    assert.equal(browserStorage(), null);
    assert.doesNotThrow(() => new DeviceDiscovery());
    assert.doesNotThrow(() => new DiagnosticLog());
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
});

test("device records migrate missing protocol/port, remove invalid entries and deduplicate", () => {
  const saved = storage({ "opwebview.devices.v1": encode([
    { host: "192.168.1.5", authority: "192.168.1.5", lastConnected: 100 },
    "192.168.1.5", null, { protocol: "ftp", authority: "comma.local" },
    { host: "comma.local", port: "5001" }, { authority: "bad host" }
  ]) });
  const devices = new DeviceDiscovery(saved).saved();
  assert.equal(devices.length, 2);
  assert.equal(devices[0].protocol, "http");
  assert.equal(devices[0].authority, "192.168.1.5:5001");
  assert.equal(devices[0].lastConnected, 100);
  assert.equal(devices[1].authority, "comma.local:5001");
  assert.deepEqual(JSON.parse(saved.data.get("opwebview.devices.v1")), devices);
});

test("current layouts preserve customization while adding defaults and removing obsolete widgets", () => {
  const saved = storage({ "opwebview.layout.v2": encode({ version: 2, activeLayout: "custom",
    layout: { speed: { x: "12", y: 10, w: 25, h: 20, hidden: false }, removedWidget: { x: 5 } } }) });
  const value = manager(saved).loadLayout();
  assert.equal(value.layout.speed.x, 12);
  assert.equal(value.layout.speed.w, 25);
  assert.equal(value.activeLayout, "custom");
  assert.equal(value.layout.removedWidget, undefined);
  assert.ok(value.layout.torque);
  assert.deepEqual(JSON.parse(saved.data.get("opwebview.layout.v2")), value);
});

test("known legacy layout migrates once; unknown future formats safely default", () => {
  const saved = storage({ "opwebview.layout.v1": encode({ speed: { x: 15, y: 8, w: 20, h: 25 } }) });
  const value = manager(saved).loadLayout();
  assert.equal(value.layout.speed.x, 15);
  assert.equal(value.activeLayout, "custom");
  assert.equal(saved.data.has("opwebview.layout.v1"), false);
  assert.deepEqual(manager(saved).loadLayout(), value);
  saved.setItem("opwebview.layout.v2", encode({ version: 99, activeLayout: 123, layout: createPresetLayout("classic") }));
  assert.equal(manager(saved).loadLayout().activeLayout, "classic");
  assert.equal(saved.data.has("opwebview.layout.v2"), false);
});

test("layout geometry cannot become negative, non-finite, off-screen or zero-sized", () => {
  const layout = normalizeLayout({ speed: { x: 1e100, y: -500, w: -20, h: 200, hidden: "false" },
    cruise: { x: null, y: false, w: "NaN", h: [], hidden: null } });
  assert.deepEqual(layout.speed, { x: 84, y: 0, w: 16, h: 100, hidden: false });
  assert.deepEqual(layout.cruise, createPresetLayout("classic").cruise);
  assert.equal(normalizeLayout({ status: { x: 20, y: 90, w: 60, h: 1.5, hidden: false } }).status.h, 1.5,
    "small but valid preset-derived cells must not be enlarged");
});

test("bad named layouts are removed independently; invalid active labels never break rendering", () => {
  const saved = storage({ "opwebview.layouts.named.v1": encode({ Drive: { speed: { x: 12 } }, Broken: null, Future: { widgets: [] } }),
    "opwebview.layout.v2": encode({ version: 2, activeLayout: 123, layout: createPresetLayout("classic") }) });
  const widgets = manager(saved);
  assert.deepEqual(Object.keys(widgets.namedLayouts()), ["Drive"]);
  Object.assign(widgets, widgets.loadLayout());
  assert.equal(widgets.activeLabel(), "Custom");
  assert.equal(widgets.applyNamed("toString"), false);
});

test("stored diagnostics discard corrupt events rather than breaking log/QR rendering", () => {
  const saved = storage({ "opwebview.diagnostics.v1": encode([null, {}, { at: "bad", level: "info" },
    { at: "2026-10-11T00:00:00Z", level: "info", source: "test", message: "valid" }]) });
  const log = new DiagnosticLog(saved);
  assert.equal(log.entries.length, 1);
  assert.match(log.text(), /valid/);
  assert.doesNotThrow(() => JSON.parse(log.qrPayload()));
});
