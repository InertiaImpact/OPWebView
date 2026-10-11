import test from "node:test";
import assert from "node:assert/strict";
import { StartupConnection, localNetworkPermission } from "../public/src/core/startup-connection.js";
import { DeviceDiscovery } from "../public/src/core/device-discovery.js";
import { installFullscreenGesture } from "../public/src/core/fullscreen-gesture.js";

function harness(devices, permission = "granted") {
  const connected = [], statuses = [], timers = new Map();
  let next = 0, idle = true;
  const discovery = {
    scan: async ({ onReachable }) => { devices.forEach(onReachable); return devices; },
    probe: async () => true
  };
  const startup = new StartupConnection({ discovery, permission: async () => permission,
    connect: async (device) => { connected.push(device); return true; }, idle: () => idle,
    status: (...args) => statuses.push(args),
    setTimer: (callback, delay) => { timers.set(++next, { callback, delay }); return next; },
    clearTimer: (id) => timers.delete(id)
  });
  return { startup, connected, statuses, timers, discovery, setIdle: (value) => { idle = value; } };
}

test("an available saved device connects immediately without a timer", async () => {
  const device = {host:"192.168.1.10", reachable:true, lastConnected:123};
  const h = harness([device]);
  await h.startup.start();
  assert.deepEqual(h.connected, [device]); assert.equal(h.timers.size, 0);
});

test("first new device waits five seconds and is rechecked before connection", async () => {
  const first = {host:"192.168.1.10", reachable:true}, second = {host:"192.168.1.11", reachable:true};
  const h = harness([first, second]);
  await h.startup.start();
  assert.equal(h.connected.length, 0); assert.equal(h.timers.size, 1);
  const timer = [...h.timers.values()][0]; assert.equal(timer.delay, 5000);
  await timer.callback(); assert.deepEqual(h.connected, [first]);
});

test("a saved device takes priority over a pending new-device countdown", async () => {
  const saved = {host:"192.168.1.11", reachable:true, lastConnected:123};
  const h = harness([{host:"comma.local", reachable:true}, saved]);
  await h.startup.start();
  assert.deepEqual(h.connected, [saved]); assert.equal(h.timers.size, 0);
});

test("cancel, demo/manual busy state and disappearing devices prevent auto-connect", async () => {
  for (const action of ["cancel", "busy", "disappeared"]) {
    const h = harness([{host:"comma.local", reachable:true}]);
    await h.startup.start(); const timer = [...h.timers.values()][0];
    if (action === "cancel") h.startup.cancel();
    if (action === "busy") h.setIdle(false);
    if (action === "disappeared") h.discovery.probe = async () => false;
    await timer.callback(); assert.equal(h.connected.length, 0);
  }
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

test("double taps enter synchronously only when enabled; drag, controls and long taps are ignored", () => {
  const target = new EventTarget(); let time = 0, enabled = true, calls = 0;
  const remove = installFullscreenGesture({target,enabled:()=>enabled,now:()=>time,enter:()=>{calls++;}});
  const dispatch = (type,x,y,blocked=false) => {
    const event = new Event(type,{cancelable:true});
    Object.defineProperty(event,"target",{value:{closest:()=>blocked}});
    Object.assign(event,{pointerId:1,clientX:x,clientY:y,button:0,isPrimary:true}); target.dispatchEvent(event);
  };
  const tap = (x=10,y=10,blocked=false) => { dispatch("pointerdown",x,y,blocked); time+=50; dispatch("pointerup",x,y,blocked); time+=50; };
  tap(); tap(); assert.equal(calls,1);
  enabled=false; tap(); tap(); assert.equal(calls,1);
  enabled=true; tap(10,10,true); tap(10,10,true); assert.equal(calls,1);
  dispatch("pointerdown",10,10); time+=50; dispatch("pointerup",80,10); tap(); assert.equal(calls,1);
  time+=400; dispatch("pointerdown",10,10); time+=400; dispatch("pointerup",10,10); tap(); assert.equal(calls,1);
  remove(); tap(); tap(); assert.equal(calls,1);
});
