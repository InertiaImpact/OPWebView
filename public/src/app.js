import { TelemetryStore } from "./core/state.js?v=3";
import { CerealAdapter } from "./core/telemetry-adapter.js?v=3";
import { DeviceDiscovery } from "./core/device-discovery.js?v=2";
import { WebRTCTransport } from "./core/webrtc-transport.js?v=4";
import { ConnectionManager } from "./core/connection-manager.js?v=2";
import { OverlayRenderer } from "./render/overlay-renderer.js";
import { BUILT_IN_LAYOUTS, WidgetManager } from "./widgets/widget-manager.js?v=3";
import { DemoFeed } from "./demo.js?v=3";
import { APP_BUILD, DiagnosticLog } from "./core/diagnostic-log.js?v=3";
import { ViewportController } from "./core/viewport-controller.js";

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
  controlsToggle: $("#controls-toggle"),
  install: $("#install-button"),
  diagnostics: $("#diagnostics-button"),
  connectionDiagnostics: $("#connection-diagnostics-button"),
  diagnosticsDialog: $("#diagnostics-dialog"),
  diagnosticsOutput: $("#diagnostics-output"),
  diagnosticsCount: $("#diagnostics-count"),
  diagnosticsQr: $("#diagnostics-qr"),
  diagnosticsQrSize: $("#diagnostics-qr-size"),
  copyDiagnostics: $("#copy-diagnostics-button"),
  downloadDiagnostics: $("#download-diagnostics-button"),
  clearDiagnostics: $("#clear-diagnostics-button"),
  checkUpdate: $("#check-update-button"),
  networkPermission: $("#network-permission-status"),
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
const renderer = new OverlayRenderer(elements.canvas, store, elements.video);
const widgets = new WidgetManager({
  layer: elements.widgetLayer,
  toggles: elements.widgetToggles,
  store
});
const demo = new DemoFeed(adapter);
const diagnostics = new DiagnosticLog();
const viewport = new ViewportController({ app: elements.app, video: elements.video, renderer, widgets,
  onChange: (detail) => diagnostics.add("info", "viewport", `Presentation changed to ${detail.mode}`, detail) });

let demoActive = false;
let installPrompt = null;
let toastTimer = null;
let updateRegistration = null;
let networkPermission = null;
let updateReloadPending = false;

function streamBusy() {
  return connection.connecting || store.state.isConnected || Boolean(connection.retryTimer);
}

async function refreshNetworkPermission() {
  try {
    networkPermission = await navigator.permissions.query({ name: "local-network" });
    networkPermission.onchange = () => refreshNetworkPermission();
    const state = networkPermission.state;
    elements.networkPermission.textContent = state === "denied"
      ? "Local-network access is blocked. Open this site's Chrome settings and allow Local network access, then return here. No need to clear site data."
      : state === "prompt"
        ? "Press Connect or Scan network and allow Chrome's local-network prompt."
        : "Local-network access is allowed.";
    diagnostics.add(state === "denied" ? "warn" : "info", "permission", `Local-network permission: ${state}`);
    return state;
  } catch {
    networkPermission = null;
    elements.networkPermission.textContent = "Allow local-network access if your browser asks when connecting.";
    return "unknown";
  }
}

function setConnectionStatus(status, label) {
  elements.app.dataset.status = status;
  elements.connectionPill.textContent = label;
}

function openConnectionDialog() {
  refreshNetworkPermission();
  renderDevices(discovery.saved());
  elements.connectionError.hidden = true;
  elements.connectionError.dataset.kind = "error";
  if (!elements.connectionDialog.open) elements.connectionDialog.showModal();
  queueMicrotask(() => elements.connectionDialog.querySelector(".close-button")?.focus({ preventScroll: true }));
}

function renderDiagnostics() {
  const text = diagnostics.text();
  const qrPayload = diagnostics.qrPayload();
  elements.diagnosticsOutput.textContent = text;
  elements.diagnosticsCount.textContent = `${diagnostics.entries.length} events`;
  elements.diagnosticsQrSize.textContent = `${new TextEncoder().encode(qrPayload).length} bytes`;
  elements.diagnosticsQr.replaceChildren();
  try {
    const factory = globalThis.qrcode;
    if (typeof factory !== "function") throw new Error("QR generator unavailable");
    factory.stringToBytes = factory.stringToBytesFuncs["UTF-8"];
    const qr = factory(0, "M");
    qr.addData(qrPayload, "Byte");
    qr.make();
    elements.diagnosticsQr.innerHTML = qr.createSvgTag(5, 20);
  } catch (error) {
    elements.diagnosticsQr.textContent = `QR generation failed: ${error.message}`;
  }
}

function openDiagnostics() {
  renderDiagnostics();
  if (!elements.diagnosticsDialog.open) elements.diagnosticsDialog.showModal();
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
  diagnostics.add("info", "connection", "Connection requested", { device: input.authority || input.host || String(input) });
  try {
    if (await refreshNetworkPermission() === "denied") {
      throw new Error("Local-network access is blocked in Chrome's settings for this site. Allow it there and retry; your offline files and layouts can stay saved.");
    }
    await connection.connect(input);
    elements.connectionDialog.close();
    setConnectionStatus("connected", input.label || input.host || "Connected");
    showToast("Camera and telemetry are live.");
  } catch (error) {
    diagnostics.add("error", "connection", error.message || "Connection failed", error);
    setConnectionStatus("offline", connection.retryCount > 0 ? "Retrying" : "Connection failed");
    elements.connectionError.dataset.kind = "error";
    elements.connectionError.textContent = error.message || "Connection failed.";
    elements.connectionError.hidden = false;
  } finally {
    elements.connectSubmit.disabled = false;
    applyReadyUpdate();
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
    elements.alert.dataset.fullscreen = String(state.alertSize === 3 || state.alertStatus === 2);
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
      elements.app.classList.remove("controls-open");
      elements.controlsToggle.setAttribute("aria-expanded", "false");
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
  if (elements.app.dataset.presentation !== "full" && force !== false) {
    showToast("Return to the full dashboard to edit your layout.");
    return;
  }
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
  try {
    if (await refreshNetworkPermission() === "denied") {
      showToast("Allow Local network access in this site's Chrome settings before scanning.");
      return;
    }
    renderDevices(await discovery.scan());
  } finally {
    elements.discover.disabled = false;
    elements.discover.textContent = "Scan network";
  }
});
discovery.addEventListener("scanstart", () => diagnostics.add("info", "discovery", "Network scan started"));
discovery.addEventListener("scanprogress", (event) => {
  elements.discover.textContent = event.detail;
  diagnostics.add("info", "discovery", event.detail);
});
discovery.addEventListener("scancomplete", (event) => diagnostics.add("info", "discovery", "Network scan completed", {
  devices: event.detail.map((device) => ({ address: device.authority, reachable: device.reachable }))
}));
elements.diagnostics.addEventListener("click", openDiagnostics);
elements.connectionDiagnostics.addEventListener("click", openDiagnostics);
elements.copyDiagnostics.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(diagnostics.text());
    showToast("Diagnostic log copied.");
  } catch {
    showToast("Copy is unavailable; use Download instead.");
  }
});
elements.downloadDiagnostics.addEventListener("click", () => {
  const blob = new Blob([diagnostics.text()], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `opwebview-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
elements.clearDiagnostics.addEventListener("click", () => {
  diagnostics.clear();
  renderDiagnostics();
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
  viewport.refresh();
});

elements.controlsToggle.addEventListener("click", () => {
  const open = elements.app.classList.toggle("controls-open");
  elements.controlsToggle.setAttribute("aria-expanded", String(open));
});
elements.fullscreen.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
    elements.app.classList.remove("controls-open");
    elements.controlsToggle.setAttribute("aria-expanded", "false");
    viewport.refresh();
  } catch { showToast("Fullscreen is not available in this browser."); }
});
document.addEventListener("fullscreenchange", () => {
  elements.fullscreen.setAttribute("aria-pressed", String(Boolean(document.fullscreenElement)));
  elements.fullscreen.setAttribute("aria-label", document.fullscreenElement ? "Exit fullscreen" : "Toggle fullscreen");
});
elements.video.addEventListener("playing", () => {
  elements.app.classList.add("video-ready");
  diagnostics.add("info", "video", "First playable camera frame received");
});
elements.video.addEventListener("emptied", () => elements.app.classList.remove("video-ready"));
store.addEventListener("change", updateUi);
connection.addEventListener("state", (event) => {
  diagnostics.add(event.detail === "failed" ? "error" : "info", "webrtc", `State changed to ${event.detail}`);
  if (demoActive) return;
  if (["connecting", "waiting"].includes(event.detail)) setConnectionStatus("connecting", event.detail === "waiting" ? "Starting streams" : "Connecting");
  else if (event.detail === "connected") setConnectionStatus("connected", connection.device?.label || "Connected");
  else if (event.detail === "failed") setConnectionStatus("offline", connection.retryCount > 0 ? "Reconnecting" : "Connection failed");
  else if (event.detail === "offline") setConnectionStatus("offline", "Offline");
  else setConnectionStatus("disconnected", "Offline");
});
connection.addEventListener("progress", (event) => {
  diagnostics.add("info", "webrtc", event.detail);
  if (!elements.connectionDialog.open) return;
  elements.connectionError.dataset.kind = "progress";
  elements.connectionError.textContent = event.detail;
  elements.connectionError.hidden = false;
});
connection.addEventListener("retry", (event) => {
  diagnostics.add("warn", "webrtc", `Connection lost; retry ${event.detail} of 3`);
  showToast(`Connection lost. Retry ${event.detail} of 3…`);
});
window.addEventListener("error", (event) => diagnostics.add("error", "browser", event.message, {
  file: event.filename?.split("/").at(-1), line: event.lineno, column: event.colno
}));
window.addEventListener("unhandledrejection", (event) => diagnostics.add("error", "browser", "Unhandled promise rejection", event.reason));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && store.state.isConnected) connection.acquireWakeLock();
  if (document.visibilityState === "visible") {
    refreshNetworkPermission();
    checkForUpdates();
  }
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

function applyReadyUpdate() {
  if (streamBusy()) return;
  if (updateReloadPending) {
    window.location.reload();
    return;
  }
  if (updateRegistration?.waiting) {
    diagnostics.add("info", "service-worker", "Complete update ready; activating while idle");
    updateRegistration.waiting.postMessage({ type: "ACTIVATE_UPDATE" });
  }
}

async function checkForUpdates(manual = false) {
  if (!updateRegistration) return;
  try {
    await updateRegistration.update();
    diagnostics.add("info", "service-worker", "Update check completed", { waiting: Boolean(updateRegistration.waiting) });
    applyReadyUpdate();
    if (manual) showToast(updateRegistration.waiting || updateRegistration.installing
      ? "Update downloading or ready. It will apply when disconnected."
      : "Update check complete. Your saved offline app is ready.");
  } catch (error) {
    diagnostics.add("info", "service-worker", "Update server unavailable; keeping saved offline app", error);
    if (manual) showToast("Update server unavailable. Your saved offline app is still available.");
  }
}

elements.checkUpdate.addEventListener("click", () => checkForUpdates(true));
window.addEventListener("online", () => checkForUpdates());
connection.addEventListener("state", () => {
  // Manager finishes changing its connecting state after emitting events.
  setTimeout(applyReadyUpdate, 0);
});

if ("serviceWorker" in navigator) {
  let serviceWorkerRefreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (serviceWorkerRefreshing) return;
    serviceWorkerRefreshing = true;
    if (streamBusy()) {
      updateReloadPending = true;
      showToast("Update ready. Reopen OP WebView after this drive.", 8000);
      return;
    }
    window.location.reload();
  });
  window.addEventListener("load", async () => {
    try {
      updateRegistration = await navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" });
      updateRegistration.addEventListener("updatefound", () => {
        const worker = updateRegistration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed") {
            diagnostics.add("info", "service-worker", "Complete release downloaded for offline use");
            applyReadyUpdate();
          }
        });
      });
      await checkForUpdates();
    } catch (error) {
      updateRegistration = await navigator.serviceWorker.getRegistration();
      if (updateRegistration?.active) {
        diagnostics.add("info", "service-worker", "Started from saved offline release; update server unavailable", error);
        applyReadyUpdate();
      } else {
        diagnostics.add("error", "service-worker", "Offline caching could not be enabled", error);
        showToast("Offline caching could not be enabled in this browser.");
      }
    }
  });
}

renderDevices(discovery.saved());
diagnostics.add("info", "app", "Application started", { build: APP_BUILD });
refreshNetworkPermission();
elements.layoutLabel.textContent = widgets.activeLabel();
updateUi();

// Exposed only for browser-driven smoke tests and diagnostics.
globalThis.__OPWEBVIEW__ = { store, adapter, discovery, connection, renderer, widgets, demo, diagnostics };
