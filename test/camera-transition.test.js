import test from "node:test";
import assert from "node:assert/strict";
import { CameraTransition } from "../public/src/core/camera-transition.js";
import { readFile } from "node:fs/promises";
import { WebRTCTransport } from "../public/src/core/webrtc-transport.js";

function fixture() {
  const classes = () => {
    const names = new Set();
    return { add: (...args) => args.forEach(x => names.add(x)), remove: (...args) => args.forEach(x => names.delete(x)), contains: x => names.has(x) };
  };
  const draws = [], root = {classList:classes()}, overlay = {getBoundingClientRect:()=>({left:50,top:20,width:1199,height:498})};
  const video = { readyState:4, videoWidth:1928, videoHeight:1208,
    getBoundingClientRect:()=>({left:-200,top:-100,width:1600,height:1000}) };
  const canvas = {hidden:true,classList:classes(),getContext:()=>({drawImage:(...args)=>draws.push(args)})};
  const label = {hidden:true};
  const renderer={held:false,holdCamera(){this.held=true;},releaseCamera(){this.held=false;}};
  return {transition:new CameraTransition({root,video,overlay,canvas,label,renderer}),root,video,overlay,canvas,label,draws,renderer};
}

test("handoff captures only the exact visible video crop and holds the live overlay projection", () => {
  const f=fixture(); assert.equal(f.transition.start(),true);
  assert.ok(f.canvas.width<=1280 && f.canvas.height<=720);
  assert.equal(f.canvas.width,1199); assert.equal(f.canvas.height,498);
  assert.equal(f.draws.length,1); assert.equal(f.draws[0][0],f.video);
  assert.equal(f.draws[0][1],-250);
  assert.ok(Math.abs(f.draws[0][2]-(-120+(1000-1208*1600/1928)/2))<1e-9);
  assert.equal(f.draws[0][3],1600);
  assert.equal(f.renderer.held,true);
  assert.equal(f.canvas.hidden,false); assert.equal(f.label.hidden,false);
  assert.equal(f.root.classList.contains("camera-switching"),true);
  f.transition.clear();
});

test("a ready replacement fades out the held frame and releases its memory", t => {
  t.mock.timers.enable({apis:["setTimeout"]});
  const f=fixture(); f.transition.start(); f.transition.finish();
  assert.equal(f.renderer.held,false,"new camera projection is released when replacement is ready");
  assert.equal(f.label.hidden,true); assert.equal(f.canvas.hidden,false);
  assert.equal(f.canvas.classList.contains("camera-snapshot-fade"),true);
  assert.equal(f.root.classList.contains("camera-switching"),false);
  assert.equal(f.root.classList.contains("camera-handoff-fading"),true);
  t.mock.timers.tick(180);
  assert.equal(f.canvas.hidden,true); assert.equal(f.canvas.width,1); assert.equal(f.transition.active,false);
  assert.equal(f.root.classList.contains("camera-handoff-fading"),false);
});

test("failure, disconnect, and a new handoff cancel obsolete fades without hiding the next frame", t => {
  t.mock.timers.enable({apis:["setTimeout"]});
  const f=fixture(); f.transition.start(); f.transition.finish();
  f.transition.start(); t.mock.timers.tick(180);
  assert.equal(f.canvas.hidden,false); assert.equal(f.label.hidden,false);
  f.transition.clear(); t.mock.timers.tick(1000);
  assert.equal(f.canvas.hidden,true); assert.equal(f.label.hidden,true);
  assert.equal(f.renderer.held,false);
});

test("missing frames, zero-sized viewports and capture failures do not leave a false frozen image", () => {
  for (const change of [f=>f.video.readyState=0, f=>f.video.videoWidth=0,
    f=>f.overlay.getBoundingClientRect=()=>({width:0,height:0}),
    f=>f.canvas.getContext=()=>({drawImage(){throw new Error("capture unavailable");}})]) {
    const f=fixture(); change(f); assert.equal(f.transition.start(),false);
    assert.equal(f.canvas.hidden,true); assert.equal(f.label.hidden,true); assert.equal(f.transition.active,false);
    assert.equal(f.renderer.held,true,"failed capture still preserves the old projection");
    f.transition.finish(); assert.equal(f.renderer.held,false);
  }
});

test("the snapshot stays below the visible model overlay, with no frozen duplicate overlay", async () => {
  const css=await readFile(new URL("../public/styles.css",import.meta.url),"utf8");
  assert.match(css, /#camera-snapshot\s*\{[^}]*z-index: 1/);
  assert.match(css, /#model-overlay\s*\{[^}]*z-index: 2/);
  assert.doesNotMatch(css,/\.camera-switching #model-overlay\s*\{/);
});

test("replacement readiness waits for a presented frame rather than loadeddata or playing", async () => {
  const video=new EventTarget(), frames=new Map(), cancelled=[];
  let nextId=0;
  Object.assign(video,{readyState:4,srcObject:null,
    requestVideoFrameCallback(fn){frames.set(++nextId,fn);return nextId;},
    cancelVideoFrameCallback(id){frames.delete(id);cancelled.push(id);}});
  const transport=new WebRTCTransport(video), ready=[];
  transport.addEventListener("video",()=>ready.push(transport.generation));
  transport.waitForPresentedVideo(()=>transport.markVideoReady(transport.generation));
  video.dispatchEvent(new Event("playing")); video.dispatchEvent(new Event("loadeddata"));
  assert.deepEqual(ready,[]);
  frames.get(1)(); assert.deepEqual(ready,[0]); assert.deepEqual(cancelled,[1]);
  transport.readiness.videoReady=false;
  transport.waitForPresentedVideo(()=>transport.markVideoReady(transport.generation));
  await transport.close(); assert.equal(frames.size,0,"close cancels callbacks from superseded video");
});

test("older-browser video readiness removes both fallback listeners and ignores obsolete generations", async () => {
  const video=new EventTarget(); Object.assign(video,{readyState:0,srcObject:null});
  const transport=new WebRTCTransport(video), ready=[];
  transport.addEventListener("video",()=>ready.push(1));
  transport.waitForPresentedVideo(()=>transport.markVideoReady(0));
  video.dispatchEvent(new Event("playing")); assert.deepEqual(ready,[]);
  video.readyState=2; video.dispatchEvent(new Event("loadeddata")); assert.deepEqual(ready,[1]);
  transport.readiness.videoReady=false;
  video.dispatchEvent(new Event("playing")); assert.deepEqual(ready,[1]);
  transport.waitForPresentedVideo(()=>transport.markVideoReady(0));
  await transport.close(); video.dispatchEvent(new Event("loadeddata")); assert.deepEqual(ready,[1]);
  transport.markVideoReady(0); assert.deepEqual(ready,[1]);
});
