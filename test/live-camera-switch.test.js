import test from "node:test";
import assert from "node:assert/strict";
import { WebRTCTransport } from "../public/src/core/webrtc-transport.js";
import { ConnectionManager } from "../public/src/core/connection-manager.js";
import { TelemetryStore } from "../public/src/core/state.js";
import { CerealAdapter } from "../public/src/core/telemetry-adapter.js";

function fixture() {
  const frames=new Map(),sent=[]; let id=0;
  const video={srcObject:{name:"existing stream",getTracks:()=>[]},
    requestVideoFrameCallback(fn){frames.set(++id,fn);return id;},
    cancelVideoFrameCallback(key){frames.delete(key);}};
  const transport=new WebRTCTransport(video);
  transport.peer={connectionState:"connected",close(){}};
  const channel=new EventTarget();Object.assign(channel,{readyState:"open",send(text){sent.push(JSON.parse(text));},close(){}});
  transport.attachChannel(channel,0);transport.sessionLive=true;transport.readiness.videoReady=true;
  transport.markTelemetryReceived(["carState","modelV2"]);
  const store=new TelemetryStore(),adapter=new CerealAdapter(store);
  const manager=new ConnectionManager({store,adapter,transport,discovery:{}});
  manager.device={host:"192.168.1.10"};store.setConnection(true);
  let connects=0,resets=0,handoffs=0;
  transport.connect=async()=>{connects++;};
  adapter.reset=()=>{resets++;};
  manager.addEventListener("handoff",()=>handoffs++);
  const packet=(type,data)=>channel.dispatchEvent(new MessageEvent("message",{data:JSON.stringify({type,data})}));
  const frame=()=>{const fn=frames.values().next().value;assert.ok(fn);fn();};
  return {video,transport,channel,frames,sent,store,adapter,manager,packet,frame,
    connects:()=>connects,resets:()=>resets,handoffs:()=>handoffs};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test("in-session camera switching keeps peer, stream, telemetry, adapter and overlay active", async () => {
  const h=fixture(),peer=h.transport.peer,channel=h.transport.channel,stream=h.video.srcObject;
  const states=[];h.manager.addEventListener("state",e=>states.push(e.detail));
  h.packet("carState",{vEgo:5});h.packet("selfdriveState",{experimentalMode:true});
  assert.deepEqual(h.sent.at(-1),{type:"livestreamCameraSwitch",data:{camera:"wideRoad"}});
  assert.equal(h.store.state.isSwitchingStream,true);assert.equal(h.store.state.streamType,"road");
  h.packet("carState",{vEgo:6});h.packet("modelV2",{position:{x:[0,10],y:[0,.5],z:[0,0]}});
  assert.equal(h.store.state.vEgo,6);assert.deepEqual(h.store.state.pathY,[0,.5]);
  assert.equal(h.transport.hasFreshTelemetry(),true);assert.equal(h.store.state.isConnected,true);
  h.frame();await settle();
  assert.equal(h.store.state.streamType,"wideRoad");assert.equal(h.store.state.isSwitchingStream,false);
  assert.equal(h.transport.peer,peer);assert.equal(h.transport.channel,channel);assert.equal(h.video.srcObject,stream);
  assert.equal(h.connects(),0);assert.equal(h.resets(),0);assert.equal(h.handoffs(),0);
  assert.deepEqual(states,[],"no connecting UI or snapshot hides the live overlay");
  await h.manager.disconnect();
});

test("camera changes serialize, retain hysteresis and use the latest telemetry mode", async () => {
  const h=fixture();h.packet("carState",{vEgo:5});h.packet("selfdriveState",{experimentalMode:true});
  h.packet("selfdriveState",{experimentalMode:false});
  assert.equal(h.sent.filter(p=>p.type==="livestreamCameraSwitch").length,1);
  h.frame();await settle();
  assert.equal(h.sent.at(-1).data.camera,"road");
  h.frame();await settle();assert.equal(h.store.state.streamType,"road");
  h.packet("carState",{vEgo:12});h.packet("selfdriveState",{experimentalMode:true});
  assert.equal(h.sent.filter(p=>p.type==="livestreamCameraSwitch").length,2);
  await h.manager.disconnect();
});

test("a cancelled handoff cannot change camera geometry or restart a disconnected session", async () => {
  const h=fixture();h.packet("carState",{vEgo:5});h.packet("selfdriveState",{experimentalMode:true});
  const late=h.frames.values().next().value;
  await h.manager.disconnect();late();await settle();
  assert.equal(h.store.state.streamType,"road");assert.equal(h.store.state.isConnected,false);
  assert.equal(h.frames.size,0);assert.equal(h.connects(),0);
});

test("stalled presentation falls back once to the existing replacement-session path", async t => {
  t.mock.timers.enable({apis:["setTimeout"]});
  const h=fixture(),diagnostics=[];h.manager.addEventListener("diagnostic",e=>diagnostics.push(e.detail));
  h.packet("carState",{vEgo:5});h.packet("selfdriveState",{experimentalMode:true});
  t.mock.timers.tick(5000);await settle();
  assert.equal(h.connects(),1);assert.equal(h.resets(),1);assert.equal(h.handoffs(),1);
  assert.equal(h.manager.streamType,"wideRoad");assert.equal(h.frames.size,0);
  assert.equal(diagnostics[0].kind,"camera-switch-fallback");
  assert.equal(h.manager.retryTimer,null);await h.manager.disconnect();
});

test("link failure during camera switching uses bounded link recovery, not a second handoff", async () => {
  const h=fixture();h.packet("carState",{vEgo:5});h.packet("selfdriveState",{experimentalMode:true});
  h.transport.dispatchState("failed");await settle();
  assert.equal(h.manager.retryCount,1);assert.notEqual(h.manager.retryTimer,null);
  assert.equal(h.connects(),0);assert.equal(h.store.state.isConnected,false);assert.equal(h.frames.size,0);
  await h.manager.disconnect();
});

test("older browsers retain the known camera reconnect fallback", async () => {
  const h=fixture();delete h.video.requestVideoFrameCallback;
  h.packet("carState",{vEgo:5});h.packet("selfdriveState",{experimentalMode:true});await settle();
  assert.equal(h.connects(),1);assert.equal(h.sent.filter(p=>p.type==="livestreamCameraSwitch").length,0);
  await h.manager.disconnect();
});

test("transport rejects invalid/unready requests and obsolete frames cannot cancel a newer switch", async () => {
  const h=fixture();await assert.rejects(h.transport.switchCamera("driver"),/Unknown/);
  h.channel.readyState="closed";await assert.rejects(h.transport.switchCamera("road"),/not ready/);h.channel.readyState="open";
  const first=h.transport.switchCamera("wideRoad"),late=h.frames.values().next().value;
  const cancelled=assert.rejects(first,/cancelled/);h.transport.cancelCameraSwitch();await cancelled;
  const second=h.transport.switchCamera("road");
  late();assert.equal(h.frames.size,1);h.frame();await second;
  await h.manager.disconnect();
});

test("background/PiP pauses camera changes without treating stopped frame callbacks as link failure", async t => {
  t.mock.timers.enable({apis:["setTimeout"]});
  const previous=globalThis.document,page=new EventTarget();page.hidden=false;globalThis.document=page;
  t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
  const h=fixture();h.packet("carState",{vEgo:5});h.packet("selfdriveState",{experimentalMode:true});
  page.hidden=true;page.dispatchEvent(new Event("visibilitychange"));await settle();
  t.mock.timers.tick(10000);await settle();
  assert.equal(h.connects(),0);assert.equal(h.frames.size,0);assert.equal(h.store.state.isConnected,true);
  h.packet("carState",{vEgo:6});assert.equal(h.frames.size,0,"no camera-switch loop while hidden");
  page.hidden=false;h.packet("carState",{vEgo:6});assert.equal(h.frames.size,1);
  h.frame();await settle();assert.equal(h.store.state.streamType,"wideRoad");
  await h.manager.disconnect();
});
