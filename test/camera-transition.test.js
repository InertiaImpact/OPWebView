import test from "node:test";
import assert from "node:assert/strict";
import { CameraTransition } from "../public/src/core/camera-transition.js";

function fixture() {
  const classes = () => {
    const names = new Set();
    return { add: (...args) => args.forEach(x => names.add(x)), remove: (...args) => args.forEach(x => names.delete(x)), contains: x => names.has(x) };
  };
  const draws = [], root = {classList:classes()}, overlay = {};
  const video = { readyState:4, videoWidth:1928, videoHeight:1208, getBoundingClientRect:()=>({width:2400,height:1000}) };
  const canvas = {hidden:true,classList:classes(),getContext:()=>({drawImage:(...args)=>draws.push(args)})};
  const label = {hidden:true};
  return {transition:new CameraTransition({root,video,overlay,canvas,label}),root,video,overlay,canvas,label,draws};
}

test("handoff holds one cover-cropped frame and its overlay, with a visible switching label", () => {
  const f=fixture(); assert.equal(f.transition.start(),true);
  assert.ok(f.canvas.width<=1280 && f.canvas.height<=720);
  assert.equal(f.draws.length,2); assert.equal(f.draws[0][0],f.video); assert.equal(f.draws[1][0],f.overlay);
  assert.ok(f.draws[0][2]<0,"cover crop matches the displayed camera rather than stretching it");
  assert.equal(f.canvas.hidden,false); assert.equal(f.label.hidden,false);
  assert.equal(f.root.classList.contains("camera-switching"),true);
  f.transition.clear();
});

test("a ready replacement fades out the held frame and releases its memory", t => {
  t.mock.timers.enable({apis:["setTimeout"]});
  const f=fixture(); f.transition.start(); f.transition.finish();
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
});

test("missing frames, zero-sized viewports and capture failures do not leave a false frozen image", () => {
  for (const change of [f=>f.video.readyState=0, f=>f.video.videoWidth=0,
    f=>f.video.getBoundingClientRect=()=>({width:0,height:0}),
    f=>f.canvas.getContext=()=>({drawImage(){throw new Error("capture unavailable");}})]) {
    const f=fixture(); change(f); assert.equal(f.transition.start(),false);
    assert.equal(f.canvas.hidden,true); assert.equal(f.label.hidden,true); assert.equal(f.transition.active,false);
  }
});
