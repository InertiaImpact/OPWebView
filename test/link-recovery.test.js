import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { WebRTCTransport, DISCONNECT_GRACE_MS } from "../public/src/core/webrtc-transport.js";
import { ConnectionManager } from "../public/src/core/connection-manager.js";

function harness() {
  const transport = new WebRTCTransport({ srcObject: null });
  const peer = { connectionState: "connected", iceConnectionState: "connected", close() {} };
  transport.peer = peer;
  transport.sessionLive = true;
  transport.markTelemetryReceived(["carState", "modelV2"]);
  const store = { state: { isConnected: true }, setConnection(value) { this.state.isConnected = value; }, update(fn) { fn(this.state); } };
  const manager = new ConnectionManager({ transport, store, adapter: { reset() {}, apply() {} }, discovery: {} });
  manager.device = { host: "192.168.169.233" };
  const states = [], details = [];
  manager.addEventListener("state", (event) => states.push(event.detail));
  manager.addEventListener("diagnostic", (event) => details.push(event.detail));
  const change = (state) => {
    peer.connectionState = peer.iceConnectionState = state;
    transport.handlePeerState(peer, transport.generation);
  };
  return { transport, peer, manager, store, states, details, change };
}

test("brief peer interruptions recover in place without scheduling a replacement stream", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness();
  h.change("disconnected");
  assert.deepEqual(h.states, ["interrupted"]); assert.equal(h.manager.retryTimer, null);
  t.mock.timers.tick(4000);
  h.change("connected");
  t.mock.timers.tick(DISCONNECT_GRACE_MS + 2000);
  assert.deepEqual(h.states, ["interrupted", "connected"]);
  assert.equal(h.transport.peer, h.peer);
  assert.equal(h.manager.retryTimer, null);
  assert.equal(h.details[0].ice, "disconnected");
  await h.manager.disconnect();
});

test("repeated disconnected/checking events cannot extend the five-second recovery deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness();
  h.change("disconnected"); t.mock.timers.tick(3000);
  h.change("connecting"); h.change("disconnected"); t.mock.timers.tick(2000);
  assert.equal(h.states.at(-1), "failed");
  assert.equal(h.manager.retryCount, 1); assert.notEqual(h.manager.retryTimer, null);
  assert.equal(h.details.at(-1).kind, "recovery-timeout");
  await h.manager.disconnect();
});

test("terminal failure skips grace, and recovery before a queued retry cancels that retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness();
  h.change("failed");
  assert.equal(h.manager.retryCount, 1);
  assert.equal(h.transport.disconnectTimer, null);
  h.change("connected");
  assert.equal(h.manager.retryTimer, null); assert.equal(h.manager.retryCount, 0);
  assert.equal(h.store.state.isConnected, true);
  t.mock.timers.tick(10000);
  assert.equal(h.transport.peer, h.peer);
  await h.manager.disconnect();
});

test("startup still uses its normal readiness path; close cancels pending interruption callbacks", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness();
  h.transport.sessionLive = false;
  h.change("connected"); assert.equal(h.states.at(-1), "waiting");
  h.change("disconnected"); assert.equal(h.states.at(-1), "failed");
  assert.equal(h.transport.disconnectTimer, null);
  await h.manager.disconnect();
  const another = harness(); another.change("disconnected");
  await another.manager.disconnect();
  const count = another.states.length;
  t.mock.timers.tick(10000);
  another.transport.handlePeerState(another.peer, another.transport.generation - 1);
  assert.equal(another.states.length, count);
});

test("recovered connections dismiss stale panel/dialog UI; retries stay unobtrusive, exhaustion remains actionable", async () => {
  const app = await readFile(new URL("../public/src/app.js", import.meta.url), "utf8");
  const source = app.match(/function handleConnectionState\(state\) \{[\s\S]*?\n\}/)[0];
  const elements = { connectionDialog: { open: true, close() { this.open = false; } }, connectionError: { hidden: false } };
  let label, status, syncs = 0;
  const context = { elements, demoActive: false, devicePanelOpen: true,
    connection: { device: { label: "My comma" }, retryCount: 0, retryTimer: null },
    diagnostics: { add() {} }, setConnectionStatus(s, l) { status = s; label = l; }, syncDevicePanel() { syncs++; } };
  vm.createContext(context); vm.runInContext(source, context);
  vm.runInContext('handleConnectionState("connected")', context);
  assert.equal(elements.connectionDialog.open, false); assert.equal(elements.connectionError.hidden, true);
  assert.equal(context.devicePanelOpen, false); assert.equal(status, "connected"); assert.equal(label, "My comma");
  vm.runInContext('handleConnectionState("interrupted")', context);
  assert.equal(context.devicePanelOpen, false); assert.equal(status, "offline");
  context.connection.retryTimer = 1; context.connection.retryCount = 1;
  vm.runInContext('handleConnectionState("failed")', context);
  assert.equal(context.devicePanelOpen, false);
  context.connection.retryTimer = null; context.connection.retryCount = 0;
  vm.runInContext('handleConnectionState("offline")', context);
  assert.equal(context.devicePanelOpen, true); assert.ok(syncs >= 3);
  vm.runInContext('handleConnectionState("connected")', context);
  assert.equal(context.devicePanelOpen, false);
});
