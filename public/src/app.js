import { TelemetryStore } from "./core/state.js?v=3";
import { CerealAdapter } from "./core/telemetry-adapter.js?v=3";
import { DeviceDiscovery } from "./core/device-discovery.js?v=4";
import { WebRTCTransport } from "./core/webrtc-transport.js?v=6";
import { ConnectionManager } from "./core/connection-manager.js?v=5";
import { OverlayRenderer } from "./render/overlay-renderer.js";
import { BUILT_IN_LAYOUTS, WidgetManager } from "./widgets/widget-manager.js?v=3";
import { DemoFeed } from "./demo.js?v=3";
import { APP_BUILD, DiagnosticLog, fullLogQrPages } from "./core/diagnostic-log.js?v=5";
import { ViewportController } from "./core/viewport-controller.js";
import { StartupConnection, localNetworkPermission } from "./core/startup-connection.js?v=3";
import { installFullscreenGesture } from "./core/fullscreen-gesture.js";
import { DevWatermark } from "./core/dev-watermark.js";
import { installLayoutGesture } from "./core/layout-gesture.js";
import { installPanelDrag } from "./core/movable-panel.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  app: $("#app"),
  viewport: $(".viewport"),
  devicePanel: $("#device-panel"),
  widgetPanel: $("#widget-panel"),
  video: $("#road-video"),
  canvas: $("#model-overlay"),
  streamHealth: $("#stream-health"),
  connectionPill: $("#connection-pill"),
  connectionDialog: $("#connection-dialog"),
  connectionForm: $("#connection-form"),
  connectionError: $("#connection-error"),
  host: $("#device-host"),
  connectSubmit: $("#connect-submit"),
  deviceList: $("#device-list"),
  discover: $("#discover-button"),
  connect: $("#connect-button"),
  demo: $("#demo-button"),
  layoutLabel: $("#layout-label"),
  editTray: $("#edit-tray"),
  doneEditing: $("#done-editing-button"),
  resetLayout: $("#reset-layout-button"),
  widgetLayer: $("#widget-layer"),
  widgetToggles: $("#widget-toggles"),
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
  diagnosticsQrMode: $("#diagnostics-qr-mode"),
  diagnosticsQrPrevious: $("#diagnostics-qr-previous"),
  diagnosticsQrNext: $("#diagnostics-qr-next"),
  diagnosticsQrHint: $("#diagnostics-qr-hint"),
  copyDiagnostics: $("#copy-diagnostics-button"),
  downloadDiagnostics: $("#download-diagnostics-button"),
  clearDiagnostics: $("#clear-diagnostics-button"),
  checkUpdate: $("#check-update-button"),
  networkPermission: $("#network-permission-status"),
  startupStatus: $("#startup-status"),
  startupMessage: $("#startup-message"),
  startupCancel: $("#startup-cancel"),
  alert: $("#alert-banner"),
  alertTitle: $("#alert-title"),
  alertDetail: $("#alert-detail"),
  toast: $("#toast")
};

const store = new TelemetryStore();
const diagnostics = new DiagnosticLog();
const adapter = new CerealAdapter(store, { onDiscard: (message) => diagnostics.add("warn", "telemetry", message) });
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
const devWatermark = new DevWatermark($(".dev-watermark"));
const viewport = new ViewportController({ app: elements.app, video: elements.video, renderer, widgets,
  onChange: (detail) => {
    if (detail.mode !== "full" && widgets.editing) toggleEditing(false);
    diagnostics.add("info", "viewport", `Presentation changed to ${detail.mode}`, detail);
  } });

let demoActive = false;
let devicePanelOpen = true;
let listedDevices = [];
let installPrompt = null;
let toastTimer = null;
let updateRegistration = null;
let networkPermission = null;
let updateReloadPending = false;
let detailedQrPages = null;
let detailedQrIndex = 0;
const editorPanels = [elements.editTray, elements.widgetPanel].map((panel) => installPanelDrag({
  panel, handle: panel.querySelector(".dock-header"), boundsElement: elements.app,
  enabled: () => widgets.editing
}));
const startup = new StartupConnection({ discovery,
  permission: refreshNetworkPermission,
  connect: (device) => connectDevice(device, { automatic: true }),
  idle: () => !demoActive && !streamBusy() && !document.hidden && !widgets.editing,
  status: (state, message) => {
    elements.startupStatus.hidden = state === "idle";
    elements.startupMessage.textContent = message || "";
    elements.startupCancel.hidden = state !== "scanning";
    elements.discover.disabled = ["scanning", "connecting"].includes(state);
    if (state !== "idle") diagnostics.add(state === "permission" ? "warn" : "info", "startup", message || state);
  }
});

function streamBusy() {
  return connection.connecting || store.state.isConnected || Boolean(connection.retryTimer);
}

async function refreshNetworkPermission() {
  try {
    networkPermission = await localNetworkPermission();
    if (!networkPermission) throw new Error("Permission query unsupported");
    networkPermission.onchange = async () => {
      const state = await refreshNetworkPermission();
      if (state === "granted" && !startup.running && !elements.startupStatus.hidden && !demoActive && !streamBusy()) startup.start();
    };
    const state = networkPermission.state;
    elements.networkPermission.hidden = state === "granted";
    elements.networkPermission.textContent = state === "denied"
      ? "Network access blocked. Allow it in Chrome site settings."
      : state === "prompt"
        ? "Connect or scan, then allow network access."
        : "Local-network access is allowed.";
    diagnostics.add(state === "denied" ? "warn" : "info", "permission", `Local-network permission: ${state}`);
    return state;
  } catch {
    networkPermission = null;
    elements.networkPermission.hidden = false;
    elements.networkPermission.textContent = "Allow network access if asked.";
    return "unknown";
  }
}

function setConnectionStatus(status, label) {
  elements.app.dataset.status = status;
  elements.connectionPill.textContent = label;
}

function syncDevicePanel() {
  elements.devicePanel.hidden = widgets.editing || !devicePanelOpen;
  const open = !elements.devicePanel.hidden;
  const parent = open ? elements.devicePanel.querySelector(".dock-header") : elements.app;
  // One control and handler: part of the open header, a top-left pill when closed.
  if (elements.controlsToggle.parentElement !== parent) {
    parent.insertBefore(elements.controlsToggle, open ? elements.connectionPill : elements.devicePanel);
  }
  elements.controlsToggle.hidden = widgets.editing || (!devicePanelOpen && elements.app.dataset.status === "connected");
  elements.controlsToggle.setAttribute("aria-expanded", String(open));
  elements.controlsToggle.setAttribute("aria-label", open ? "Collapse devices" : "Show devices");
}

function openConnectionDialog() {
  startup.cancel();
  refreshNetworkPermission();
  elements.connectionError.hidden = true;
  elements.connectionError.dataset.kind = "error";
  if (!elements.connectionDialog.open) elements.connectionDialog.showModal();
  queueMicrotask(() => elements.connectionDialog.querySelector(".close-button")?.focus({ preventScroll: true }));
}

function renderDiagnostics() {
  const text = diagnostics.text();
  const qrPayload = detailedQrPages ? detailedQrPages[detailedQrIndex] : diagnostics.qrPayload();
  elements.diagnosticsOutput.textContent = text;
  elements.diagnosticsCount.textContent = `${diagnostics.entries.length} events`;
  elements.diagnosticsQrSize.textContent = `${detailedQrPages ? `${detailedQrIndex + 1}/${detailedQrPages.length} · ` : ""}${new TextEncoder().encode(qrPayload).length} bytes`;
  elements.diagnosticsQrMode.textContent = detailedQrPages ? "Summary QR" : "Full log QR";
  elements.diagnosticsQrMode.setAttribute("aria-pressed", String(Boolean(detailedQrPages)));
  elements.diagnosticsQrPrevious.hidden = elements.diagnosticsQrNext.hidden = !detailedQrPages;
  elements.diagnosticsQrPrevious.disabled = detailedQrIndex === 0;
  elements.diagnosticsQrNext.disabled = !detailedQrPages || detailedQrIndex === detailedQrPages.length - 1;
  elements.diagnosticsQrHint.textContent = detailedQrPages
    ? `Full-log snapshot: scan all ${detailedQrPages.length} numbered pages. Reopen logs for a fresh snapshot.`
    : "Quick summary includes the latest warning/error. Full log QR keeps all stored events.";
  elements.diagnosticsQr.setAttribute("aria-label", detailedQrPages
    ? `Full diagnostic log QR part ${detailedQrIndex + 1} of ${detailedQrPages.length}` : "QR code containing compact diagnostic JSON");
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
  detailedQrPages = null;
  detailedQrIndex = 0;
  renderDiagnostics();
  if (!elements.diagnosticsDialog.open) elements.diagnosticsDialog.showModal();
}

function renderDevices(devices) {
  devices = devices.filter((device) => device.reachable === true);
  listedDevices = devices;
  const available = devices.length > 0;
  elements.demo.hidden = available;
  if (available && demoActive) stopDemo();
  elements.deviceList.replaceChildren();
  if (!devices.length) {
    const empty = document.createElement("p");
    empty.className = "device-empty";
    empty.textContent = "No devices found yet.";
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
    const connected = !demoActive && store.state.isConnected && connection.device?.authority === device.authority;
    address.textContent = `${device.authority} · found on this network`;
    summary.append(name, address);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = connected ? "Connected" : "Connect";
    button.hidden = device.reachable !== true;
    button.disabled = connected || connection.connecting;
    button.addEventListener("click", () => connectDevice(device));
    card.append(summary, button);
    elements.deviceList.append(card);
  }
}

async function connectDevice(input, { automatic = false } = {}) {
  if (!automatic) startup.cancel();
  if (connection.connecting) return;
  stopDemo();
  if (elements.connectionDialog.open) elements.connectionDialog.close();
  devicePanelOpen = true;
  syncDevicePanel();
  elements.connectionError.hidden = true;
  elements.connectSubmit.disabled = true;
  setConnectionStatus("connecting", "Connecting");
  renderDevices(listedDevices);
  diagnostics.add("info", "connection", "Connection requested", { device: input.authority || input.host || String(input) });
  try {
    if (await refreshNetworkPermission() === "denied") {
      throw new Error("Network access blocked. Allow it in Chrome site settings.");
    }
    await connection.connect(input);
    showToast("Camera and telemetry are live.");
    return true;
  } catch (error) {
    const retrying = Boolean(connection.retryTimer);
    diagnostics.add(retrying ? "warn" : "error", "connection", error.message || "Connection failed", error);
    setConnectionStatus("offline", retrying ? "Retrying" : "Connection failed");
    if (retrying) {
      elements.connectionError.hidden = true;
      devicePanelOpen = false;
      syncDevicePanel();
      return true; // Recovery accepted, not a claim that telemetry is ready.
    }
    elements.connectionError.dataset.kind = "error";
    elements.connectionError.textContent = error.retryable ? "Data not ready. Tap Connect to retry." : error.message || "Connection failed.";
    elements.connectionError.hidden = false;
    devicePanelOpen = true;
    syncDevicePanel();
    return false;
  } finally {
    elements.connectSubmit.disabled = false;
    renderDevices(listedDevices);
    applyReadyUpdate();
  }
}

function startDemo() {
  startup.cancel();
  connection.disconnect().catch(() => {});
  demoActive = true;
  elements.app.classList.add("demo-active");
  elements.demo.setAttribute("aria-pressed", "true");
  setConnectionStatus("connected", "Demo");
  demo.start();
  devicePanelOpen = false;
  syncDevicePanel();
}

function stopDemo() {
  if (!demoActive) return;
  demoActive = false;
  demo.stop();
  elements.app.classList.remove("demo-active");
  elements.demo.setAttribute("aria-pressed", "false");
  store.resetTelemetry();
  setConnectionStatus("disconnected", "Offline");
  devicePanelOpen = true;
  syncDevicePanel();
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
  devWatermark.update({ connected: state.isConnected, onRoad: state.started,
    demo: demoActive, hasStream: Boolean(elements.video.srcObject), ready: elements.video.readyState >= 2 });
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
  if (elements.app.dataset.presentation !== "full" && force !== false) {
    showToast("Return to the full dashboard to edit your layout.");
    return;
  }
  const editing = typeof force === "boolean" ? force : !widgets.editing;
  if (editing) startup.cancel();
  widgets.setEditing(editing);
  elements.app.classList.toggle("layout-editing", editing);
  elements.editTray.hidden = !editing;
  elements.widgetPanel.hidden = !editing;
  if (editing) renderLayoutDialog();
  for (const panel of editorPanels) editing ? panel.constrain() : panel.cancelDrag();
  syncDevicePanel();
}

for (const panel of [elements.editTray, elements.widgetPanel]) {
  const button = panel.querySelector(".panel-collapse");
  button.addEventListener("click", () => {
    const collapsed = panel.classList.toggle("panel-collapsed");
    button.textContent = collapsed ? "+" : "−";
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${panel === elements.editTray ? "views" : "widgets"}`);
  });
}
$("#editing-devices-button").addEventListener("click", () => {
  toggleEditing(false);
  devicePanelOpen = true;
  syncDevicePanel();
});

elements.connectionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    elements.connectionDialog.close();
    return;
  }
  connectDevice(elements.host.value);
});
elements.connect.addEventListener("click", openConnectionDialog);
elements.discover.addEventListener("click", async () => {
  if (!streamBusy() && !demoActive) { await startup.start(); return; }
  startup.cancel();
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
elements.startupCancel.addEventListener("click", () => {
  startup.cancel();
  showToast("Automatic connection cancelled. Use Connect when ready.");
});
document.addEventListener("visibilitychange", () => { if (document.hidden) startup.cancel(); });
discovery.addEventListener("scanstart", () => {
  renderDevices(!demoActive && store.state.isConnected && connection.device ? [{ ...connection.device, reachable: true }] : []);
  elements.discover.disabled = true;
  diagnostics.add("info", "discovery", "Network scan started");
});
discovery.addEventListener("scanreport", (event) => {
  diagnostics.add(event.detail.found || event.detail.cancelled ? "info" : "warn", "discovery", "Current-network scan report", event.detail);
});
discovery.addEventListener("scanprogress", (event) => {
  elements.discover.textContent = event.detail;
  diagnostics.add("info", "discovery", event.detail);
});
discovery.addEventListener("devicefound", (event) => renderDevices([
  event.detail, ...listedDevices.filter((device) => device.authority !== event.detail.authority)
]));
discovery.addEventListener("scancomplete", (event) => {
  elements.discover.disabled = false;
  elements.discover.textContent = "Scan network";
  const active = !demoActive && store.state.isConnected && connection.device;
  renderDevices(active && !event.detail.some((device) => device.authority === active.authority)
    ? [{ ...active, reachable: true }, ...event.detail] : event.detail);
  diagnostics.add("info", "discovery", "Network scan completed", {
    devices: event.detail.map((device) => ({ address: device.authority, reachable: device.reachable }))
  });
});
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
  detailedQrPages = null;
  detailedQrIndex = 0;
  diagnostics.clear();
  renderDiagnostics();
});
elements.diagnosticsQrMode.addEventListener("click", () => {
  // Freeze one snapshot so new events cannot reorder pages during capture.
  detailedQrPages = detailedQrPages ? null : fullLogQrPages(diagnostics.text());
  detailedQrIndex = 0;
  renderDiagnostics();
});
elements.diagnosticsQrPrevious.addEventListener("click", () => {
  if (detailedQrPages && detailedQrIndex > 0) { detailedQrIndex--; renderDiagnostics(); }
});
elements.diagnosticsQrNext.addEventListener("click", () => {
  if (detailedQrPages && detailedQrIndex < detailedQrPages.length - 1) { detailedQrIndex++; renderDiagnostics(); }
});
elements.demo.addEventListener("click", toggleDemo);
elements.doneEditing.addEventListener("click", () => toggleEditing(false));
elements.resetLayout.addEventListener("click", () => {
  widgets.reset();
  showToast("Widget layout reset.");
});
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
  if (widgets.editing) renderLayoutDialog();
  viewport.refresh();
  renderer.schedule();
});

elements.controlsToggle.addEventListener("click", () => {
  devicePanelOpen = !devicePanelOpen;
  syncDevicePanel();
  if (!elements.controlsToggle.hidden) elements.controlsToggle.focus({ preventScroll: true });
});
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else {
      await document.documentElement.requestFullscreen();
      devicePanelOpen = false;
      syncDevicePanel();
    }
    viewport.refresh();
  } catch { showToast("Fullscreen is not available in this browser."); }
}
installFullscreenGesture({ target: elements.app,
  enabled: () => !widgets.editing && (Boolean(document.fullscreenElement) || demoActive ||
    (store.state.isConnected && store.state.started && Boolean(elements.video.srcObject) && elements.video.readyState >= 2)),
  toggle: toggleFullscreen
});
elements.fullscreen.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", () => {
  elements.fullscreen.setAttribute("aria-pressed", String(Boolean(document.fullscreenElement)));
  elements.fullscreen.setAttribute("aria-label", document.fullscreenElement ? "Exit fullscreen" : "Toggle fullscreen");
});
installLayoutGesture({ target: elements.viewport,
  enabled: () => !document.hidden && !widgets.editing && elements.app.dataset.presentation === "full",
  unlock: () => toggleEditing(true)
});
document.addEventListener("keydown", (event) => {
  if (event.target.closest?.("input, textarea, select, [contenteditable]")) return;
  if (event.key === "Escape" && widgets.editing) toggleEditing(false);
  if (event.shiftKey && event.key.toLowerCase() === "l") { event.preventDefault(); toggleEditing(); }
});
elements.video.addEventListener("playing", () => {
  elements.app.classList.add("video-ready");
  updateUi();
  diagnostics.add("info", "video", "First playable camera frame received");
});
elements.video.addEventListener("emptied", () => {
  elements.app.classList.remove("video-ready");
  updateUi();
});
store.addEventListener("change", updateUi);
function handleConnectionState(state) {
  diagnostics.add(state === "failed" ? "error" : "info", "webrtc", `State changed to ${state}`);
  if (demoActive) return;
  if (["connecting", "waiting"].includes(state)) setConnectionStatus("connecting", state === "waiting" ? "Starting streams" : "Connecting");
  else if (state === "connected") {
    setConnectionStatus("connected", connection.device?.label || "Connected");
    if (elements.connectionDialog.open) elements.connectionDialog.close();
    elements.connectionError.hidden = true;
    devicePanelOpen = false;
    syncDevicePanel();
  }
  else if (state === "interrupted") setConnectionStatus("offline", "Recovering link");
  else if (state === "failed") {
    setConnectionStatus("offline", connection.retryCount > 0 ? "Reconnecting" : "Connection failed");
    // Automatic retries use the status/toast, not an obstructing device panel.
    if (!connection.connecting && !connection.retryTimer && connection.retryCount === 0) devicePanelOpen = true;
    syncDevicePanel();
  }
  else if (state === "offline") {
    setConnectionStatus("offline", "Offline");
    devicePanelOpen = true;
    syncDevicePanel();
  }
  else setConnectionStatus("disconnected", "Offline");
}
connection.addEventListener("state", (event) => handleConnectionState(event.detail));
connection.addEventListener("connected", (event) => {
  if (!transport.staleServices.length) elements.streamHealth.hidden = true;
  renderDevices([{ ...event.detail, reachable: true }, ...listedDevices.filter((device) => device.authority !== event.detail.authority)]);
});
connection.addEventListener("video", () => {
  if (demoActive) return;
  if (elements.connectionDialog.open) elements.connectionDialog.close();
  elements.connectionError.hidden = true;
  if (!store.state.isConnected) {
    elements.streamHealth.textContent = "Waiting for data…";
    elements.streamHealth.hidden = false;
  }
  devicePanelOpen = false;
  syncDevicePanel();
});
connection.addEventListener("error", (event) => {
  if (demoActive || connection.userClosed) return;
  const error = event.detail;
  diagnostics.add(connection.retryTimer ? "warn" : "error", "connection", error.message || "Connection failed", error);
  if (connection.retryTimer) return;
  elements.streamHealth.hidden = true;
  elements.connectionError.textContent = error.retryable ? "Data not ready. Tap Connect to retry." : error.message || "Connection failed.";
  elements.connectionError.hidden = false;
  devicePanelOpen = true;
  syncDevicePanel();
});
connection.addEventListener("diagnostic", (event) => {
  const detail = event.detail;
  const interrupted = ["failed", "disconnected", "closed"].includes(detail.peer) || ["channel-error", "channel-close", "recovery-timeout"].includes(detail.kind);
  diagnostics.add(interrupted ? "warn" : "info", "webrtc", `Link ${detail.kind}: ${detail.peer || "unknown"}; ICE ${detail.ice || "unknown"}`, detail);
});
connection.addEventListener("progress", (event) => {
  diagnostics.add("info", "webrtc", event.detail);
  if (!elements.connectionDialog.open) return;
  elements.connectionError.dataset.kind = "progress";
  elements.connectionError.textContent = event.detail;
  elements.connectionError.hidden = false;
});
connection.addEventListener("retry", (event) => {
  devicePanelOpen = false;
  syncDevicePanel();
  diagnostics.add("warn", "webrtc", `Retrying stream ${event.detail} of 3`, {
    peer: transport.peer?.connectionState, ice: transport.peer?.iceConnectionState,
    channel: transport.channel?.readyState, online: navigator.onLine, hidden: document.hidden
  });
  showToast(`Retrying stream ${event.detail} of 3…`);
});
connection.addEventListener("health", (event) => {
  const stale = event.detail.staleServices;
  elements.streamHealth.hidden = !stale.length;
  elements.streamHealth.textContent = stale.length ? "Telemetry delayed — values may be outdated" : "";
  if (stale.length) diagnostics.add("warn", "telemetry", "Live telemetry delayed", { services: stale });
});
window.addEventListener("error", (event) => diagnostics.add("error", "browser", event.message, {
  file: event.filename?.split("/").at(-1), line: event.lineno, column: event.colno
}));
window.addEventListener("unhandledrejection", (event) => diagnostics.add("error", "browser", "Unhandled promise rejection", event.reason));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && store.state.isConnected) connection.acquireWakeLock();
  if (document.visibilityState === "visible") {
    transport.resumeTelemetryHealth();
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

renderDevices([]);
diagnostics.add("info", "app", "Application started", { build: APP_BUILD });
refreshNetworkPermission();
window.addEventListener("load", () => startup.start(), { once: true });
elements.layoutLabel.textContent = widgets.activeLabel();
syncDevicePanel();
updateUi();

// Exposed only for browser-driven smoke tests and diagnostics.
globalThis.__OPWEBVIEW__ = { store, adapter, discovery, connection, renderer, widgets, demo, diagnostics };
