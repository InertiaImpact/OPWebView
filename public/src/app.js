import { TelemetryStore } from "./core/state.js?v=2";
import { CerealAdapter } from "./core/telemetry-adapter.js?v=2";
import { DeviceDiscovery } from "./core/device-discovery.js";
import { WebRTCTransport } from "./core/webrtc-transport.js?v=4";
import { ConnectionManager } from "./core/connection-manager.js";
import { OverlayRenderer } from "./render/overlay-renderer.js";
import { BUILT_IN_LAYOUTS, WidgetManager } from "./widgets/widget-manager.js?v=2";
import { DemoFeed } from "./demo.js?v=2";

const $ = (selector) => document.querySelector(selector);
const elements = {
  app: $("#app"),
  video: $("#road-video"),
  canvas: $("#model-overlay"),
  connectionPill: $("#connection-pill"),
  connectionDialog: $("#connection-dialog"),
  connectionForm: $("#connection-form"),
  connectionError: $("#connection-error"),
  host: $("#device-host"),
  connectSubmit: $("#connect-submit"),
  deviceList: $("#device-list"),
  discover: $("#discover-button"),
  connect: $("#connect-button"),
  emptyConnect: $("#empty-connect"),
  demo: $("#demo-button"),
  emptyDemo: $("#empty-demo"),
  edit: $("#edit-button"),
  editIcon: $("#edit-icon"),
  editLabel: $("#edit-label"),
  layoutButton: $("#layout-button"),
  layoutLabel: $("#layout-label"),
  editTray: $("#edit-tray"),
  doneEditing: $("#done-editing-button"),
  resetLayout: $("#reset-layout-button"),
  widgets: $("#widgets-button"),
  editLayouts: $("#edit-layouts-button"),
  widgetDialog: $("#widget-dialog"),
  widgetLayer: $("#widget-layer"),
  widgetToggles: $("#widget-toggles"),
  layoutDialog: $("#layout-dialog"),
  layoutPresets: $("#layout-presets"),
  savedLayouts: $("#saved-layouts"),
  layoutName: $("#layout-name"),
  saveLayout: $("#save-layout-button"),
  fullscreen: $("#fullscreen-button"),
  install: $("#install-button"),
  alert: $("#alert-banner"),
  alertTitle: $("#alert-title"),
  alertDetail: $("#alert-detail"),
  toast: $("#toast")
};

const store = new TelemetryStore();
const adapter = new CerealAdapter(store);
const discovery = new DeviceDiscovery();
const transport = new WebRTCTransport(elements.video);
const connection = new ConnectionManager({ store, transport, adapter, discovery });
const renderer = new OverlayRenderer(elements.canvas, store);
const widgets = new WidgetManager({
  layer: elements.widgetLayer,
  toggles: elements.widgetToggles,
  store
});
const demo = new DemoFeed(adapter);

let demoActive = false;
let installPrompt = null;
let toastTimer = null;

function setConnectionStatus(status, label) {
  elements.app.dataset.status = status;
  elements.connectionPill.textContent = label;
}

function openConnectionDialog() {
  renderDevices(discovery.saved());
  elements.connectionError.hidden = true;
  elements.connectionError.dataset.kind = "error";
  if (!elements.connectionDialog.open) elements.connectionDialog.showModal();
  queueMicrotask(() => elements.host.focus());
}

function renderDevices(devices) {
  elements.deviceList.replaceChildren();
  if (!devices.length) {
    const empty = document.createElement("p");
    empty.className = "device-empty";
    empty.textContent = "No saved device yet. Enter its local address or scan for a known hostname.";
    elements.deviceList.append(empty);
    return;
  }
  for (const device of devices) {
    const card = document.createElement("div");
    card.className = "device-card";
    const summary = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = device.displayName || device.label || device.host;
    const address = document.createElement("span");
    address.textContent = `${device.authority}${device.reachable === true ? " · available" : device.reachable === false ? " · not found" : ""}`;
    summary.append(name, address);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Connect";
    button.addEventListener("click", () => connectDevice(device));
    card.append(summary, button);
    elements.deviceList.append(card);
  }
}

async function connectDevice(input) {
  stopDemo();
  elements.connectionError.hidden = true;
  elements.connectSubmit.disabled = true;
  setConnectionStatus("connecting", "Connecting");
  try {
    await connection.connect(input);
    elements.connectionDialog.close();
    setConnectionStatus("connected", input.label || input.host || "Connected");
    showToast("Camera and telemetry are live.");
  } catch (error) {
    setConnectionStatus("offline", "Retrying");
    elements.connectionError.dataset.kind = "error";
    elements.connectionError.textContent = error.message || "Connection failed.";
    elements.connectionError.hidden = false;
  } finally {
    elements.connectSubmit.disabled = false;
  }
}

function startDemo() {
  connection.disconnect().catch(() => {});
  demoActive = true;
  elements.app.classList.add("demo-active");
  elements.demo.setAttribute("aria-pressed", "true");
  setConnectionStatus("connected", "Demo");
  demo.start();
}

function stopDemo() {
  if (!demoActive) return;
  demoActive = false;
  demo.stop();
  elements.app.classList.remove("demo-active");
  elements.demo.setAttribute("aria-pressed", "false");
  store.resetTelemetry();
  setConnectionStatus("disconnected", "Offline");
}

function toggleDemo() {
  if (demoActive) stopDemo();
  else startDemo();
}

function showToast(message, timeout = 3200) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => { elements.toast.hidden = true; }, timeout);
}

function updateUi() {
  const state = store.state;
  elements.app.dataset.driveState = state.status;
  const hasAlert = state.alertSize > 0 && (state.alertText1 || state.alertText2);
  elements.alert.hidden = !hasAlert;
  elements.app.classList.toggle("blind-left", state.showBlindSpot && state.leftBlindspot);
  elements.app.classList.toggle("blind-right", state.showBlindSpot && state.rightBlindspot);
  if (hasAlert) {
    elements.alertTitle.textContent = state.alertText1;
    elements.alertDetail.textContent = state.alertText2;
    elements.alert.dataset.level = state.alertStatus === 2 ? "critical" : state.alertStatus === 1 ? "prompt" : "normal";
  }
}

function openLayoutDialog() {
  renderLayoutDialog();
  if (!elements.layoutDialog.open) elements.layoutDialog.showModal();
}

function renderLayoutDialog() {
  elements.layoutPresets.replaceChildren();
  for (const [id, preset] of Object.entries(BUILT_IN_LAYOUTS)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "layout-preset";
    button.dataset.active = String(widgets.activeLayout === id);
    button.innerHTML = `<strong>${preset.name}</strong><span>${preset.description}</span>`;
    button.addEventListener("click", () => {
      widgets.applyPreset(id);
      renderLayoutDialog();
      showToast(`${preset.name} layout recalled.`);
    });
    elements.layoutPresets.append(button);
  }

  elements.savedLayouts.replaceChildren();
  const saved = widgets.namedLayouts();
  if (!Object.keys(saved).length) {
    const empty = document.createElement("p");
    empty.className = "saved-layout-empty";
    empty.textContent = "No custom layouts saved yet.";
    elements.savedLayouts.append(empty);
  }
  for (const name of Object.keys(saved).sort((a, b) => a.localeCompare(b))) {
    const row = document.createElement("div");
    row.className = "saved-layout-row";
    const label = document.createElement("strong");
    label.textContent = name;
    const use = document.createElement("button");
    use.type = "button";
    use.textContent = "Recall";
    use.addEventListener("click", () => {
      widgets.applyNamed(name);
      renderLayoutDialog();
      showToast(`${name} recalled.`);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger-button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      widgets.deleteNamed(name);
      renderLayoutDialog();
    });
    row.append(label, use, remove);
    elements.savedLayouts.append(row);
  }
  elements.layoutLabel.textContent = widgets.activeLabel();
}

function toggleEditing(force) {
  const editing = typeof force === "boolean" ? force : !widgets.editing;
  widgets.setEditing(editing);
  elements.edit.setAttribute("aria-pressed", String(editing));
  elements.editIcon.textContent = editing ? "🔓" : "🔒";
  elements.editLabel.textContent = editing ? "Editing" : "Unlock";
  elements.editTray.hidden = !editing;
}

elements.connectionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    elements.connectionDialog.close();
    return;
  }
  connectDevice(elements.host.value);
});
elements.connect.addEventListener("click", openConnectionDialog);
elements.emptyConnect.addEventListener("click", openConnectionDialog);
elements.discover.addEventListener("click", async () => {
  elements.discover.disabled = true;
  elements.discover.textContent = "Scanning…";
  renderDevices(await discovery.scan());
  elements.discover.disabled = false;
  elements.discover.textContent = "Scan network";
});
elements.demo.addEventListener("click", toggleDemo);
elements.emptyDemo.addEventListener("click", startDemo);
elements.edit.addEventListener("click", () => toggleEditing());
elements.doneEditing.addEventListener("click", () => toggleEditing(false));
elements.resetLayout.addEventListener("click", () => {
  widgets.reset();
  showToast("Widget layout reset.");
});
elements.widgets.addEventListener("click", () => elements.widgetDialog.showModal());
elements.layoutButton.addEventListener("click", openLayoutDialog);
elements.editLayouts.addEventListener("click", openLayoutDialog);
elements.saveLayout.addEventListener("click", () => {
  const name = widgets.saveNamed(elements.layoutName.value);
  if (!name) {
    showToast("Enter a name for this layout.");
    elements.layoutName.focus();
    return;
  }
  elements.layoutName.value = "";
  renderLayoutDialog();
  showToast(`${name} saved on this device.`);
});
widgets.addEventListener("layoutchange", () => {
  elements.layoutLabel.textContent = widgets.activeLabel();
});
elements.fullscreen.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { showToast("Fullscreen is not available in this browser."); }
});
elements.video.addEventListener("playing", () => elements.app.classList.add("video-ready"));
elements.video.addEventListener("emptied", () => elements.app.classList.remove("video-ready"));
store.addEventListener("change", updateUi);
connection.addEventListener("state", (event) => {
  if (demoActive) return;
  if (["connecting", "waiting"].includes(event.detail)) setConnectionStatus("connecting", event.detail === "waiting" ? "Starting streams" : "Connecting");
  else if (event.detail === "connected") setConnectionStatus("connected", connection.device?.label || "Connected");
  else if (["failed", "offline"].includes(event.detail)) setConnectionStatus("offline", "Reconnecting");
  else setConnectionStatus("disconnected", "Offline");
});
connection.addEventListener("progress", (event) => {
  if (!elements.connectionDialog.open) return;
  elements.connectionError.dataset.kind = "progress";
  elements.connectionError.textContent = event.detail;
  elements.connectionError.hidden = false;
});
connection.addEventListener("retry", (event) => showToast(`Connection lost. Retry ${event.detail} of 3…`));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && store.state.isConnected) connection.acquireWakeLock();
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  elements.install.hidden = false;
});
elements.install.addEventListener("click", async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  elements.install.hidden = true;
});
window.addEventListener("appinstalled", () => showToast("OP WebView installed for offline launch."));

if ("serviceWorker" in navigator) {
  let serviceWorkerRefreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (serviceWorkerRefreshing) return;
    serviceWorkerRefreshing = true;
    if (store.state.isConnected) {
      showToast("Update ready. Reopen OP WebView after this drive.", 8000);
      return;
    }
    window.location.reload();
  });
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" });
      await registration.update();
    } catch {
      showToast("Offline caching could not be enabled in this browser.");
    }
  });
}

renderDevices(discovery.saved());
elements.layoutLabel.textContent = widgets.activeLabel();
updateUi();

// Exposed only for browser-driven smoke tests and diagnostics.
globalThis.__OPWEBVIEW__ = { store, adapter, discovery, connection, renderer, widgets, demo };
