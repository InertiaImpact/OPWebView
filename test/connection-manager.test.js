import test from "node:test";
import assert from "node:assert/strict";
import { ConnectionManager } from "../public/src/core/connection-manager.js";

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
