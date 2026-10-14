import test from "node:test";
import assert from "node:assert/strict";
import { DeviceDiscovery, normalizeHost, privateSubnetPrefix, subnetHosts } from "../public/src/core/device-discovery.js";

test("derives scan prefixes only from private IPv4 addresses", () => {
  assert.equal(privateSubnetPrefix("192.168.143.233"), "192.168.143");
  assert.equal(privateSubnetPrefix("10.42.0.8"), "10.42.0");
  assert.equal(privateSubnetPrefix("172.20.4.2"), "172.20.4");
  assert.equal(privateSubnetPrefix("8.8.8.8"), null);
  assert.equal(privateSubnetPrefix("comma.local"), null);
});

test("subnet scans exclude network and broadcast addresses", () => {
  const hosts = subnetHosts("192.168.143");
  assert.equal(hosts.length, 254);
  assert.equal(hosts[0], "192.168.143.1");
  assert.equal(hosts.at(-1), "192.168.143.254");
});

test("a saved IP that times out initially is retried and retains immediate-reconnect history", async () => {
  const saved = { ...normalizeHost("192.168.169.233"), displayName: "My comma", lastConnected: 123 };
  const discovery = new DeviceDiscovery(null);
  discovery.saved = () => [saved];
  let savedChecks = 0;
  const found = [], checked = [];
  discovery.probe = async (device) => {
    checked.push(device.host);
    return device.host === saved.host && ++savedChecks > 1;
  };
  const result = await discovery.scan({ onReachable: (device) => found.push(device) });
  assert.equal(savedChecks, 2, "one initial check and one subnet retry");
  assert.equal(checked[2], saved.host, "retry is first in the subnet, not at host 233");
  assert.equal(found.length, 1);
  assert.equal(found[0].lastConnected, 123);
  assert.equal(found[0].displayName, "My comma");
  assert.equal(result[0].reachable, true);
});

test("current browser interfaces cannot be excluded by three old saved networks", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = globalThis.RTCPeerConnection;
  let peerClosed = false;
  globalThis.RTCPeerConnection = class extends EventTarget {
    createDataChannel() {}
    async createOffer() { return {}; }
    async setLocalDescription() {
      this.localDescription = { sdp: "a=candidate:1 1 udp 1 192.168.169.2 1234 typ host\r\n" };
    }
    close() { peerClosed = true; }
  };
  try {
    const discovery = new DeviceDiscovery(null);
    const saved = ["192.168.229.10", "192.168.143.10", "192.168.42.10"].map(normalizeHost);
    discovery.saved = () => saved;
    discovery.probe = async () => false;
    const scanned = [];
    discovery.scanSubnet = async (prefix) => { scanned.push(prefix); return null; };
    const promise = discovery.scan();
    // Resolve the local ICE discovery deadline without actual network traffic.
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(1200);
    await promise;
    assert.deepEqual(scanned, ["192.168.169", "192.168.229", "192.168.143"]);
    assert.equal(peerClosed, true);
    assert.equal(discovery.saved(), saved, "saved records remain untouched");
  } finally { globalThis.RTCPeerConnection = original; }
});

test("cancelling a subnet retry cannot publish a found device", async () => {
  const discovery = new DeviceDiscovery(null), controller = new AbortController();
  discovery.probe = async () => { controller.abort(); return true; };
  assert.equal(await discovery.scanSubnet("192.168.169", new Map(), controller.signal), null);
});
