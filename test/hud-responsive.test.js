import test from "node:test";
import assert from "node:assert/strict";
import { presetGeometry, createPresetLayout } from "../public/src/widgets/layout-presets.js";
import { torqueGraph, traceGraph } from "../public/src/widgets/widget-graphs.js";
import { createInitialState, TelemetryStore, applyTelemetry, leadWarningColor } from "../public/src/core/state.js";
import { ViewportController, presentationMode } from "../public/src/core/viewport-controller.js";
import { calculateFrameTransform, cameraFor, calibrationMatrix, matvec3, projectPoint } from "../public/src/render/projection.js";
import { WidgetManager } from "../public/src/widgets/widget-manager.js";

test("presets use OPView corner anchors and source proportions across landscape aspect ratios", () => {
  for (const [w,h] of [[844,390],[1280,480],[1024,768],[1920,1080]]) {
    const { layout, unit } = presetGeometry("enhanced",w,h);
    assert.equal(unit, Math.min(w/536,h/240));
    assert.ok(Math.abs(layout.driver.w*w/100-layout.driver.h*h/100)<.001, "driver stays circular");
    assert.ok(Math.abs((layout.speed.x+layout.speed.w/2)-50)<.001, "speed stays centered");
    assert.ok(Math.abs(layout.steering.w*w/100-100*unit)<.001);
    for (const [id, value] of Object.entries(presetGeometry("detailed",w,h).layout)) {
      if (value.hidden) continue;
      assert.ok(value.y >= 0 && value.y+value.h <= 100.001, `${id} fits ${w}x${h}`);
    }
  }
  const regular = presetGeometry("detailed",1280,480).layout;
  const folded = presetGeometry("detailed",1280,480,true,new Set(["detailedSteering"])).layout;
  assert.ok(folded.detailedDriver.y < regular.detailedDriver.y, "folding reflows the column");
});

test("compact and camera-only presentation restore a saved custom layout without storage writes", () => {
  let bounds = {width:1280,height:480};
  const custom = createPresetLayout("enhanced");
  custom.speed.x = 12; custom.lead.hidden = true;
  const manager = Object.assign(Object.create(WidgetManager.prototype), {
    layer: {dataset:{},style:{setProperty(){}},closest(){return null;},getBoundingClientRect(){return bounds;}},
    store:{state:createInitialState()},layout:structuredClone(custom),activeLayout:"saved:Drive",collapsed:new Set(),
    elements:new Map(),editing:false,render(){},save(){throw new Error("Viewport must not write storage");}
  });
  manager.setDisplayMode("full");
  bounds = {width:360,height:200}; manager.setDisplayMode("compact");
  assert.deepEqual(Object.entries(manager.presentedLayout).filter(([,v])=>!v.hidden).map(([id])=>id),["speed","torque"]);
  manager.setDisplayMode("camera",true);
  bounds = {width:1280,height:480}; manager.setDisplayMode("full");
  assert.deepEqual(manager.layout,custom);
  assert.deepEqual(manager.presentedLayout,custom);
  assert.equal(manager.activeLayout,"saved:Drive");
});

test("fullscreen, orientation, background and video PiP transitions preserve the video track and restore geometry", () => {
  const target = () => new EventTarget();
  const win = Object.assign(target(), {visualViewport:target(),ResizeObserver:class {observe(){} disconnect(){}},requestAnimationFrame(fn){this.frame=fn;return 1;},cancelAnimationFrame(){}});
  const doc = Object.assign(target(),{hidden:false});
  const track = {};
  const video = Object.assign(target(),{srcObject:track,paused:false});
  let bounds = {width:1280,height:480};
  const states = [], drawings = [];
  const app = {dataset:{},getBoundingClientRect:()=>bounds};
  const controller = new ViewportController({app,video,windowRef:win,documentRef:doc,
    widgets:{setDisplayMode:(...state)=>states.push(state)},renderer:{setPresentation:(...state)=>drawings.push(state),resize(){}}});
  assert.equal(controller.mode,"full");
  bounds = {width:360,height:200}; win.dispatchEvent(new Event("resize")); win.frame();
  assert.equal(controller.mode,"compact");
  video.dispatchEvent(new Event("enterpictureinpicture")); assert.equal(controller.mode,"camera");
  doc.hidden=true; doc.dispatchEvent(new Event("visibilitychange")); assert.deepEqual(drawings.at(-1),["camera",true]);
  bounds = {width:1920,height:1080}; doc.hidden=false;
  video.dispatchEvent(new Event("leavepictureinpicture")); doc.dispatchEvent(new Event("fullscreenchange")); win.frame();
  assert.deepEqual(states.at(-1),["full",false]);
  assert.equal(video.srcObject,track);
  bounds = {width:0,height:0}; controller.refresh(); assert.equal(controller.mode,"full");
  assert.equal(presentationMode(200,120),"camera");
  controller.destroy();
});

test("camera crop and overlay use the same calibrated transform after resizing or switching camera", () => {
  for (const [w,h] of [[1280,480],[844,390],[1024,768],[360,200]]) for (const streamType of ["road","wideRoad"]) {
    const state = {...createInitialState(),streamType,rpyCalib:[0,.03,0],calStatus:"calibrated",hudLayout:"enhanced"};
    const frame = calculateFrameTransform(state,w,h);
    const config = cameraFor(state.deviceType,state.sensor);
    const camera = streamType === "road" ? config.fcam : config.ecam;
    const p = matvec3(calibrationMatrix(state),[30,1,1.22]);
    const x = camera.focalLength*p[0]/p[2]+camera.width/2;
    const y = camera.focalLength*p[1]/p[2]+camera.height/2;
    const zoom = frame.width/camera.width;
    const projected = projectPoint(frame.matrix,[30,1,1.22]);
    assert.ok(Math.abs(projected.x-(frame.left+x*zoom))<.001);
    assert.ok(Math.abs(projected.y-(frame.top+y*zoom))<.001);
    assert.ok(frame.left <= .001 && frame.top <= .001 && frame.left+frame.width >= w-.001 && frame.top+frame.height >= h-.001);
  }
});

test("Detailed traces collect real telemetry, stay bounded, and reset with the session", (t) => {
  const store = new TelemetryStore();
  let now = 100000; t.mock.method(Date,"now",()=>now);
  applyTelemetry(store,"carState",{vEgo:20,aEgo:-.4});
  applyTelemetry(store,"controlsState",{desiredCurvature:.003,curvature:.002});
  applyTelemetry(store,"carControl",{latActive:true,longActive:true,actuators:{accel:-.6}});
  applyTelemetry(store,"modelV2",{});
  assert.deepEqual(store.state.history[0],{t:now,want:1.2,got:.8,cmd:-.6,actual:-.4});
  for(let i=0;i<250;i++){now+=50;applyTelemetry(store,"modelV2",{});}
  assert.equal(store.state.history.length,200);
  now+=20000; applyTelemetry(store,"modelV2",{}); assert.equal(store.state.history.length,1);
  store.resetTelemetry(); assert.equal(store.state.history.length,0);
});

test("graphs have desired/actual semantics and torque responds in both directions", () => {
  const svg = traceGraph([{t:0,want:1,got:-1},{t:1000,want:.5,got:0}],{label:"lat accel",want:"want",got:"got",color:"#3adb6d",lo:-2,hi:2});
  assert.match(svg,/last ten seconds/); assert.match(svg,/trace-want/); assert.match(svg,/M90\.00/);
  assert.notEqual(torqueGraph(.6,"engaged"),torqueGraph(-.6,"engaged"));
  assert.equal(leadWarningColor(50,-10),"rgb(255,255,255)");
});
