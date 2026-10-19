import test from "node:test";
import assert from "node:assert/strict";
import { createChestnutState, updateChestnut, chestnutStatus, CHESTNUT_STALE_MS } from "../public/src/core/chestnut.js";
import { TelemetryStore } from "../public/src/core/state.js";
import { CerealAdapter } from "../public/src/core/telemetry-adapter.js";
import { WIDGETS } from "../public/src/widgets/widget-catalog.js";
import { WidgetManager } from "../public/src/widgets/widget-manager.js";
import { createPresetLayout, normalizeLayout } from "../public/src/widgets/layout-presets.js";
import { chestnutPowerGraph } from "../public/src/widgets/widget-graphs.js";
import { WebRTCTransport, resolveBridgeServices } from "../public/src/core/webrtc-transport.js";

const payload = { tempC:72,memoryTempC:65,powerDrawW:48.2,powerLimitW:75,gpuUsagePercent:60,
  gpuClockMhz:1800,fanSpeedRpm:2100,pcieLtssm:0x78,supplyVoltage:12540,supplyCurrent:4200,supplyFault:false };
const widgets = WIDGETS.filter(w=>w.id.startsWith("chestnut"));
const packet = (data=payload,valid=true,logMonoTime=1) => JSON.stringify({type:"chestnutState",valid,logMonoTime,data});

test("Chestnut maps schema fields/units, retains validity and rejects out-of-order messages", () => {
  const store=new TelemetryStore(),adapter=new CerealAdapter(store);
  assert.equal(adapter.apply(packet()),1);
  assert.equal(chestnutStatus(store.state.chestnut),"LIVE");
  assert.equal(store.state.chestnut.values.supplyVoltage,12.54);
  assert.equal(store.state.chestnut.values.supplyCurrent,4.2);
  assert.equal(store.state.chestnut.values.gpuClockMhz,1800);
  assert.equal(adapter.apply(packet({supplyVoltage:0},false,0)),0);
  assert.equal(store.state.chestnut.valid,true);
  adapter.apply(packet({},false,2));
  assert.equal(chestnutStatus(store.state.chestnut),"INVALID");
  assert.deepEqual(store.state.chestnut.values,{});
  adapter.apply(packet(payload,true,3));
  assert.equal(chestnutStatus(store.state.chestnut),"LIVE");
  const transport=new WebRTCTransport({srcObject:null});
  transport.markTelemetryReceived(adapter.lastAppliedTypes);
  assert.equal(transport.hasFreshTelemetry(),false,"Chestnut cannot falsely satisfy core telemetry readiness");
  adapter.reset();assert.equal(chestnutStatus(store.state.chestnut),"UNAVAILABLE");
  assert.deepEqual(store.state.chestnut.history,[]);
  assert.equal(adapter.apply(packet(payload,true,1)),1,"new session permits a different device uptime");
});

test("missing/default/invalid GPU readings never become fake measured zeros", () => {
  const c=createChestnutState();
  updateChestnut(c,{supplyVoltage:12000,supplyCurrent:-500,supplyFault:true,pcieLtssm:0}, {valid:true},100);
  assert.equal(c.gpuAvailable,false);assert.equal(c.values.powerDrawW,null);assert.equal(c.values.supplyCurrent,-.5);
  updateChestnut(c,{...payload,tempC:NaN,memoryTempC:Infinity,gpuUsagePercent:101,fanSpeedRpm:-1},{valid:true},200);
  for(const key of ["tempC","memoryTempC","gpuUsagePercent","fanSpeedRpm"])assert.equal(c.values[key],null);
  updateChestnut(c,{...payload,powerDrawW:0,gpuUsagePercent:0,fanSpeedRpm:0},{valid:true},300);
  assert.equal(c.values.powerDrawW,0,"genuine GPU idle measurements are retained");
  assert.equal(c.values.gpuUsagePercent,0);assert.equal(c.values.fanSpeedRpm,0);
  assert.equal(chestnutStatus(c,300+CHESTNUT_STALE_MS+1),"STALE");
  updateChestnut(c,payload,{},500);assert.equal(chestnutStatus(c,500),"INVALID","validity must be explicit");
});

test("power history is bounded to 60 seconds/61 samples and breaks after invalid or missing telemetry", () => {
  const c=createChestnutState();
  for(let now=0;now<=120000;now+=100)updateChestnut(c,payload,{valid:true},now);
  assert.ok(c.history.length<=61);assert.ok(c.history.every(s=>s.t>=60000));
  assert.ok(c.history.every((s,i)=>!i || s.t-c.history[i-1].t>=1000));
  updateChestnut(c,{}, {valid:false},120100);
  updateChestnut(c,payload,{valid:true},121000);assert.equal(c.history.at(-1).gap,true);
  updateChestnut(c,payload,{valid:true},125000);assert.equal(c.history.at(-1).gap,true);
  const svg=chestnutPowerGraph(c,125000);
  assert.match(svg,/last sixty seconds/);assert.match(svg,/0–80 W/);
  assert.ok((svg.match(/M/g)||[]).length>=5,"separate subpaths across outages for draw and limit");
  assert.doesNotMatch(svg,/NaN|Infinity/);
  updateChestnut(c,payload,{valid:true},10);assert.equal(c.history.length,1,"clock rollback starts a new trace");
});

test("widgets render real measurements, faults, unavailable and stale states without changing presets", () => {
  const store=new TelemetryStore(),adapter=new CerealAdapter(store);
  for(const w of widgets)assert.match(w.render(store.state),/UNAVAILABLE/);
  adapter.apply(packet());
  assert.match(widgets[0].render(store.state),/72°C/);
  assert.match(widgets[1].render(store.state),/12\.54 V/);
  assert.match(widgets[1].render(store.state),/48\.2 W/);
  assert.match(widgets[1].render(store.state),/UP · 0x78/);
  adapter.apply(packet({...payload,supplyFault:true},true,2));
  assert.match(widgets[1].render(store.state),/class="danger">FAULT/);
  store.state.chestnut.receivedAt=Date.now()-4000;
  for(const w of widgets){const html=w.render(store.state);assert.match(html,/STALE/);assert.doesNotMatch(html,/48\.2 W|72°C|12\.54 V/);}
  adapter.apply(packet({supplyVoltage:12000,supplyCurrent:500,pcieLtssm:120,supplyFault:false},true,3));
  assert.match(widgets[0].render(store.state),/GPU N\/A/);
  assert.match(widgets[1].render(store.state),/12\.00 V/);
  for(const preset of ["classic","enhanced","detailed"]){
    const layout=createPresetLayout(preset);
    for(const w of widgets)assert.equal(layout[w.id].hidden,true);
    const old=structuredClone(layout);for(const w of widgets)delete old[w.id];old.speed.x=23;
    const migrated=normalizeLayout(old,preset);assert.equal(migrated.speed.x,23);
    for(const w of widgets)assert.equal(migrated[w.id].hidden,true);
  }
});

test("optional Chestnut schema is omitted on unsupported forks without removing core telemetry", async () => {
  const services=await resolveBridgeServices({host:"192.168.1.10",port:5001},async url=>({ok:!decodeURIComponent(url).includes("chestnutState")}));
  assert.ok(services.includes("modelV2"));assert.ok(services.includes("carState"));assert.ok(services.includes("driverMonitoringState"));
  assert.equal(services.includes("chestnutState"),false);
});

test("a visible Chestnut widget gets one slow freshness timer, paused by background/PiP", t => {
  t.mock.timers.enable({apis:["setTimeout"]});
  const state=new TelemetryStore().state;updateChestnut(state.chestnut,payload,{valid:true});
  const surface={querySelector:()=>null},element={hidden:false,querySelector:()=>surface,classList:{toggle(){}}};
  const manager=Object.assign(Object.create(WidgetManager.prototype),{
    store:{state},elements:new Map([["chestnutGpu",element]]),layer:{dataset:{}},displayMode:"full",suspended:false,
    updateVisibility(){},collapsed:new Set(),refreshGeometry(){},scheduleIndicatorAnimation(){}
  });
  manager.render();const timer=manager.chestnutTimer;assert.ok(timer);
  manager.render();assert.equal(manager.chestnutTimer,timer);
  manager.setDisplayMode("camera",true);assert.equal(manager.chestnutTimer,null);
  t.mock.timers.tick(1000);assert.equal(manager.chestnutTimer,null);
});
