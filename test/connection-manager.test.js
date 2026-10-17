import test from "node:test";
import assert from "node:assert/strict";
import { ConnectionManager } from "../public/src/core/connection-manager.js";
import { WebRTCTransport } from "../public/src/core/webrtc-transport.js";

function harness(connect) {
  const transport = new EventTarget();
  transport.connect = connect;
  transport.close = async () => {};
  const store = {
    state: { isConnected: false },
    setConnection(value) { this.state.isConnected = value; },
    update(callback) { callback(this.state); }
  };
  const manager = new ConnectionManager({
    store,
    transport,
    adapter: { apply() {}, reset() {} },
    discovery: { remember(input) { return typeof input === "string" ? { host: input } : input; } }
  });
  return { manager, store, transport };
}

test("an initial stream negotiation failure remains visible instead of retrying forever", async () => {
  const { manager } = harness(async () => { throw new Error("camera did not start"); });
  await assert.rejects(manager.connect("192.168.1.10"), /camera did not start/);
  assert.equal(manager.retryCount, 0);
  assert.equal(manager.retryTimer, null);
});

test("a stream that drops after becoming healthy still schedules recovery", async () => {
  const { manager, store, transport } = harness(async () => {});
  manager.device = { host: "192.168.1.10" };
  store.state.isConnected = true;
  transport.dispatchEvent(new CustomEvent("state", { detail: "failed" }));
  assert.equal(manager.retryCount, 1);
  assert.notEqual(manager.retryTimer, null);
  await manager.disconnect();
});

test("ordinary connections no longer save addresses; explicit legacy saves still require success", async () => {
  const h = harness(async()=>{throw new Error("failed");});
  let remembered=0; h.manager.discovery.remember=(device)=>{remembered++;return device;};
  await assert.rejects(h.manager.connect("192.168.1.10", { remember: true })); assert.equal(remembered,0);
  h.transport.connect=async()=>{};
  await h.manager.connect("192.168.1.10"); assert.equal(remembered,0);
  await h.manager.connect("192.168.1.10", { remember: true }); assert.equal(remembered,1);
});

function pendingHarness() {
  const attempts = [];
  const h = harness((device, { camera }) => new Promise((resolve, reject) => attempts.push({ camera, resolve, reject })));
  let closes = 0, remembered = 0;
  h.transport.close = async () => { closes++; };
  h.manager.discovery.remember = (device) => { remembered++; return device; };
  h.tick = () => h.transport.dispatchEvent(new CustomEvent("data", { detail: "telemetry" }));
  return { ...h, attempts, closes: () => closes, remembered: () => remembered };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("dynamic experimental cannot close startup before video; handoffs serialize and use latest mode", async () => {
  const h = pendingHarness();
  const first = h.manager.connect("192.168.1.10");
  Object.assign(h.store.state, { experimentalMode: true, vEgo: 5 });
  for (let i = 0; i < 10; i++) h.tick();
  assert.equal(h.closes(), 0);
  assert.deepEqual(h.attempts.map((attempt) => attempt.camera), ["road"]);
  h.attempts[0].resolve(); await first;
  assert.deepEqual(h.attempts.map((attempt) => attempt.camera), ["road", "wideRoad"]);
  assert.equal(h.store.state.isSwitchingStream, true);
  Object.assign(h.store.state, { experimentalMode: false, vEgo: 25 });
  for (let i = 0; i < 10; i++) h.tick();
  assert.equal(h.attempts.length, 2, "no overlapping camera requests");
  h.attempts[1].resolve(); await settle();
  assert.deepEqual(h.attempts.map((attempt) => attempt.camera), ["road", "wideRoad", "road"]);
  h.attempts[2].resolve(); await settle();
  assert.equal(h.store.state.isSwitchingStream, false);
  assert.equal(h.manager.connecting, false);
  assert.equal(h.store.state.isConnected, true);
  assert.equal(h.remembered(), 0, "ordinary sessions and camera handoffs do not save device history");
  assert.equal(h.closes(), 0, "transport owns peer replacement without a separate close gap");
  await h.manager.disconnect();
});

test("startup uses actual speed received later, not the initial zero-speed default", async () => {
  const h = pendingHarness(), first = h.manager.connect("192.168.1.10");
  Object.assign(h.store.state, { experimentalMode: true, vEgo: 0 }); h.tick();
  h.store.state.vEgo = 25; h.tick();
  h.attempts[0].resolve(); await first;
  assert.deepEqual(h.attempts.map((attempt) => attempt.camera), ["road"]);
  assert.equal(h.closes(), 0);
  await h.manager.disconnect();
});

test("camera hysteresis retains either camera between 10 and 15 m/s", async () => {
  const h = pendingHarness(), first = h.manager.connect("192.168.1.10");
  Object.assign(h.store.state, { experimentalMode: true, vEgo: 12 });
  h.attempts[0].resolve(); await first;
  for (const speed of [10, 12, 15]) { h.store.state.vEgo = speed; h.tick(); }
  assert.equal(h.attempts.length, 1);
  h.store.state.vEgo = 9; h.tick();
  h.attempts[1].resolve(); await settle();
  for (const speed of [10, 12, 15]) { h.store.state.vEgo = speed; h.tick(); }
  assert.equal(h.attempts.length, 2);
  h.store.state.vEgo = 16; h.tick();
  h.attempts[2].resolve(); await settle();
  assert.equal(h.manager.streamType, "road");
  await h.manager.disconnect();
});

test("a cancelled startup cannot claim success or clear a newer connection attempt", async () => {
  const h = pendingHarness();
  const first = h.manager.connect("192.168.1.10");
  const rejected = assert.rejects(first, /cancelled/);
  await h.manager.disconnect();
  const second = h.manager.connect("192.168.1.11");
  h.attempts[0].resolve(); await rejected;
  assert.equal(h.manager.connecting, true);
  assert.equal(h.store.state.isConnected, false);
  assert.equal(h.remembered(), 0);
  h.attempts[1].resolve(); await second;
  assert.equal(h.store.state.isConnected, true);
  assert.equal(h.manager.device.host, "192.168.1.11");
  assert.equal(h.remembered(), 0);
  await h.manager.disconnect();
});

test("failed camera handoffs leave a visible failure and preserve bounded recovery", async () => {
  const h = pendingHarness(), first = h.manager.connect("192.168.1.10");
  h.attempts[0].resolve(); await first;
  Object.assign(h.store.state, { experimentalMode: true, vEgo: 5 }); h.tick();
  h.transport.dispatchEvent(new CustomEvent("state", { detail: "failed" }));
  h.attempts[1].reject(new Error("camera failed")); await settle();
  assert.equal(h.store.state.isConnected, false);
  assert.equal(h.store.state.isSwitchingStream, false);
  assert.equal(h.manager.connecting, false);
  assert.equal(h.manager.retryCount, 1);
  assert.notEqual(h.manager.retryTimer, null);
  h.tick(); assert.equal(h.attempts.length, 2, "failed telemetry cannot start another camera switch");
  await h.manager.disconnect();
});

test("transport cancellation during peer replacement rejects instead of silently succeeding", async () => {
  const transport = new WebRTCTransport({ srcObject: null });
  let release;
  transport.close = () => new Promise((resolve) => { release = resolve; });
  const connection = transport.connect({ host: "192.168.1.10" });
  transport.generation++; release();
  await assert.rejects(connection, /cancelled/);
  assert.equal(transport.peer, null, "cancelled attempts never allocate another peer");
});

test("startup snapshot distinguishes packet/decode progress and ignores superseded peers", async () => {
  const transport = new WebRTCTransport({ readyState: 0, paused: false });
  transport.readiness.videoTrack = true;
  const entries = [];
  transport.addEventListener("progress", (event) => entries.push(event.detail));
  transport.peer = { getStats: async () => new Map([[1, { type: "inbound-rtp", kind: "video", packetsReceived: 12, framesDecoded: 0 }]]) };
  transport.markTelemetryReceived(["carState", "modelV2"]);
  await transport.reportStartupReadiness(transport.generation, "wideRoad");
  assert.match(entries[0], /wideRoad.*track=true.*packets=12; decoded=0; telemetry=fresh/);
  let release;
  transport.peer.getStats = () => new Promise((resolve) => { release = resolve; });
  const pending = transport.reportStartupReadiness(transport.generation, "road");
  transport.generation++; release(new Map()); await pending;
  assert.equal(entries.length, 1);
});
