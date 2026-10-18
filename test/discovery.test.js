import test from "node:test";
import assert from "node:assert/strict";
import { DeviceDiscovery, discoverLocalSubnetPrefixes, privateSubnetPrefix, subnetHosts } from "../public/src/core/device-discovery.js";

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

test("session-only verified hints lead their current subnet without delaying other probes", async () => {
  const discovery = scanner(), checked=[];
  discovery.lastReachable = {host:"192.168.138.233"};
  discovery.probe = async device => { checked.push(device.host); return false; };
  await discovery.scan();
  const ips=checked.filter(host=>host!=="comma.local");
  assert.equal(ips[0],"192.168.138.233"); assert.equal(new Set(ips).size,254);
  assert.equal(ips.length,254,"a missing hint does not add duplicate requests");
  discovery.lastReachable = {host:"192.168.99.233"}; checked.length=0;
  await discovery.scan();
  assert.equal(checked.includes("192.168.99.233"),false,"old subnet is never probed");
  assert.equal(checked.filter(host=>host!=="comma.local")[0],"192.168.138.1");
});

const scanner = (prefixes = ["192.168.138"]) => {
  const discovery = new DeviceDiscovery({ getItem() { throw new Error("must not read saved IPs"); } });
  discovery.saved = () => { throw new Error("discovery must not consult historical devices"); };
  discovery.localSubnets = async () => ({ prefixes, hiddenLocalAddresses: prefixes.length === 0 });
  return discovery;
};

test("only current subnets are scanned; saved history is neither read nor listed", async () => {
  const discovery = scanner(), checked = [];
  discovery.probe = async (device) => { checked.push(device.host); return device.host === "192.168.138.233"; };
  const devices = await discovery.scan();
  assert.equal(checked.length, 255);
  assert.ok(checked.every((host) => host === "comma.local" || host.startsWith("192.168.138.")));
  assert.deepEqual(devices.map((device) => device.host), ["192.168.138.233"]);
  assert.equal(discovery.lastScan.found, 1);
});

test("comma.local and current-IP scanning run concurrently; first result publishes immediately", async () => {
  const discovery = scanner(), controller = new AbortController();
  let finishHostname;
  discovery.probe = async (device) => {
    if (device.host === "comma.local") return new Promise((resolve) => { finishHostname = resolve; });
    return device.host === "192.168.138.1";
  };
  let published;
  const scanning = discovery.scan({ signal: controller.signal, onReachable(device) { published = device; controller.abort(); } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(published.host, "192.168.138.1", "does not wait for slow hostname or other workers");
  finishHostname(false); await scanning;
});

test("manual scans retain all current-network devices and never publish after cancellation", async () => {
  const discovery = scanner();
  discovery.probe = async (device) => ["192.168.138.2", "192.168.138.233"].includes(device.host);
  assert.equal((await discovery.scan()).length, 2);
  const controller = new AbortController(), found = [];
  discovery.probe = async () => { controller.abort(); return true; };
  await discovery.scanSubnet("192.168.138", controller.signal, (device) => found.push(device));
  assert.deepEqual(found, []);
});

test("hidden interface addresses produce an explicit report, not old-subnet guesses", async () => {
  const discovery = scanner([]);
  discovery.probe = async () => false;
  const reports = [];
  discovery.addEventListener("scanreport", (event) => reports.push(event.detail));
  assert.deepEqual(await discovery.scan(), []);
  assert.deepEqual(reports[0].currentSubnets, []);
  assert.equal(reports[0].hiddenLocalAddresses, true);
  assert.equal(reports[0].checked, 1);
});

test("probe failures distinguish timeout, network blocking, HTTP and incompatible schema", async () => {
  const original = globalThis.fetch, discovery = scanner([]);
  const device = { protocol: "http", authority: "192.168.138.233:5001" };
  try {
    for (const [response, expected] of [
      [() => { throw new DOMException("deadline", "TimeoutError"); }, "timeout"],
      [() => { throw new TypeError("Failed to fetch"); }, "network"],
      [() => ({ ok: false, status: 500 }), "http"],
      [() => ({ ok: true, json: async () => ({ otherServer: true }) }), "schema"],
      [() => ({ ok: true, json: async () => ({ deviceState: [] }) }), "schema"]
    ]) {
      globalThis.fetch = response;
      const reasons = [];
      assert.equal(await discovery.probe(device, 100, undefined, (reason) => reasons.push(reason)), false);
      assert.deepEqual(reasons, [expected]);
    }
  } finally { globalThis.fetch = original; }
});

test("current-interface discovery reads candidate address, SDP and host stats and closes its peer", async () => {
  const original = globalThis.RTCPeerConnection;
  let closed = false;
  globalThis.RTCPeerConnection = class extends EventTarget {
    iceGatheringState = "complete";
    createDataChannel() {}
    async createOffer() { return {}; }
    async setLocalDescription() {
      const event = new Event("icecandidate"); event.candidate = { address: "192.168.138.3" }; this.dispatchEvent(event);
      this.localDescription = { sdp: "a=candidate:1 1 udp 1 10.42.0.2 1234 typ host\r\na=candidate:2 1 udp 1 hidden.local 1234 typ host\r\n" };
    }
    async getStats() { return new Map([[1, { type: "local-candidate", candidateType: "host", address: "172.20.4.2" }]]); }
    close() { closed = true; }
  };
  try {
    const result = await discoverLocalSubnetPrefixes();
    assert.deepEqual(result.prefixes, ["192.168.138", "10.42.0", "172.20.4"]);
    assert.equal(result.hiddenLocalAddresses, true); assert.equal(closed, true);
  } finally { globalThis.RTCPeerConnection = original; }
});
