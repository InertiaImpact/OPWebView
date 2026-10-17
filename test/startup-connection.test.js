import test from "node:test";
import assert from "node:assert/strict";
import { StartupConnection, localNetworkPermission } from "../public/src/core/startup-connection.js";
import { DeviceDiscovery } from "../public/src/core/device-discovery.js";
import { installFullscreenGesture } from "../public/src/core/fullscreen-gesture.js";

function harness(devices, permission = "granted") {
  const connected = [], statuses = [];
  let idle = true;
  const discovery = {
    scan: async ({ onReachable }) => { devices.forEach(onReachable); return devices; },
    probe: async () => true
  };
  const startup = new StartupConnection({ discovery, permission: async () => permission,
    connect: async (device) => { connected.push(device); return true; }, idle: () => idle,
    status: (...args) => statuses.push(args)
  });
  return { startup, connected, statuses, discovery, setIdle: (value) => { idle = value; } };
}

test("an available saved device connects immediately without a timer", async () => {
  const device = {host:"192.168.1.10", reachable:true, lastConnected:123};
  const h = harness([device]);
  await h.startup.start();
  assert.deepEqual(h.connected, [device]);
});

test("the first verified device connects immediately without a countdown or second probe", async () => {
  const first = {host:"192.168.1.10", reachable:true}, second = {host:"192.168.1.11", reachable:true};
  const h = harness([first, second]);
  h.discovery.probe = () => { throw new Error("already verified; no second probe needed"); };
  await h.startup.start();
  assert.deepEqual(h.connected, [first]);
  assert.equal(h.statuses.some(([state]) => state === "waiting"), false);
});

test("saved history cannot displace the first device found on this network", async () => {
  const saved = {host:"192.168.1.11", reachable:true, lastConnected:123};
  const first = {host:"192.168.2.10", reachable:true};
  const h = harness([first, saved]);
  await h.startup.start();
  assert.deepEqual(h.connected, [first]);
});

test("cancel and demo/manual busy state prevent a late scan result from connecting", async () => {
  for (const action of ["cancel", "busy"]) {
    const h = harness([]);
    let publish, finish;
    h.discovery.scan = ({ onReachable }) => { publish = onReachable; return new Promise((resolve) => { finish = resolve; }); };
    const scanning = h.startup.start();
    await new Promise((resolve) => setImmediate(resolve));
    if (action === "cancel") h.startup.cancel();
    if (action === "busy") h.setIdle(false);
    publish({host:"192.168.1.10", reachable:true}); finish([]);
    await scanning; assert.equal(h.connected.length, 0);
  }
});

test("hidden current subnet is explained without asking to clear data or change permissions", async () => {
  const h = harness([]);
  h.discovery.lastScan = { currentSubnets: [], hiddenLocalAddresses: true };
  await h.startup.start();
  assert.match(h.statuses.at(-1)[1], /browser did not expose this Wi-Fi subnet/);
});

test("denied permission never scans; prompt or unsupported query attempts local discovery", async () => {
  for (const permission of ["denied", "prompt", "unknown"]) {
    const h = harness([], permission); let scans = 0;
    h.discovery.scan = async () => { scans++; return []; };
    await h.startup.start();
    assert.equal(scans, permission === "denied" ? 0 : 1);
    assert.equal(h.connected.length, 0);
  }
});

test("permission helper falls back to the older browser alias", async () => {
  const names = [];
  const result = await localNetworkPermission({query: async ({name}) => {
    names.push(name); if (name === "local-network") throw new Error("unsupported"); return {state:"granted"};
  }});
  assert.equal(result.state, "granted"); assert.deepEqual(names, ["local-network", "local-network-access"]);
  assert.equal(await localNetworkPermission({query:async()=>{throw new Error();}}), null);
});

test("discovery validates comma schema instead of accepting arbitrary or opaque HTTP responses", async () => {
  const original = globalThis.fetch;
  try {
    const discovery = new DeviceDiscovery({getItem:()=>null});
    const device = {protocol:"http",authority:"192.168.1.10:5001"};
    for (const [schema, expected] of [[{deviceState:{type:"struct"}},true],[{},false]]) {
      globalThis.fetch = async (_url, options) => { assert.equal(options.mode,"cors"); return {ok:true,json:async()=>schema}; };
      assert.equal(await discovery.probe(device), expected);
    }
    globalThis.fetch = async () => ({ok:false}); assert.equal(await discovery.probe(device), false);
    const controller = new AbortController(); controller.abort();
    globalThis.fetch = async () => {throw new Error("must not fetch after cancel");};
    assert.equal(await discovery.probe(device,100,controller.signal),false);
  } finally { globalThis.fetch = original; }
});

test("double taps toggle synchronously only when enabled; drag, controls and long taps are ignored", () => {
  const target = new EventTarget(); let time = 0, enabled = true, calls = 0;
  const remove = installFullscreenGesture({target,enabled:()=>enabled,now:()=>time,toggle:()=>{calls++;}});
  const dispatch = (type,x,y,blocked=false) => {
    const event = new Event(type,{cancelable:true});
    Object.defineProperty(event,"target",{value:{closest:()=>blocked}});
    Object.assign(event,{pointerId:1,clientX:x,clientY:y,button:0,isPrimary:true}); target.dispatchEvent(event);
  };
  const tap = (x=10,y=10,blocked=false) => { dispatch("pointerdown",x,y,blocked); time+=50; dispatch("pointerup",x,y,blocked); time+=50; };
  tap(); tap(); assert.equal(calls,1);
  tap(); tap(); assert.equal(calls,2);
  enabled=false; tap(); tap(); assert.equal(calls,2);
  enabled=true; tap(10,10,true); tap(10,10,true); assert.equal(calls,2);
  dispatch("pointerdown",10,10); time+=50; dispatch("pointerup",80,10); tap(); assert.equal(calls,2);
  time+=400; dispatch("pointerdown",10,10); time+=400; dispatch("pointerup",10,10); tap(); assert.equal(calls,2);
  remove(); tap(); tap(); assert.equal(calls,2);
});
