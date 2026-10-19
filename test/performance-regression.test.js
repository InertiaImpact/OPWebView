import test from "node:test";
import assert from "node:assert/strict";
import { CerealAdapter, MAX_TELEMETRY_BUFFER, parseTelemetryJson } from "../public/src/core/telemetry-adapter.js";
import { TelemetryStore, applyTelemetry, createInitialState } from "../public/src/core/state.js";
import { OverlayRenderer } from "../public/src/render/overlay-renderer.js";
import { WidgetManager } from "../public/src/widgets/widget-manager.js";
import { createPresetLayout } from "../public/src/widgets/layout-presets.js";
import { paintIndicator } from "../public/src/widgets/indicator-renderer.js";
import { torquePresentation, confidencePresentation } from "../public/src/widgets/widget-graphs.js";
import { WebRTCTransport, TELEMETRY_STALE_MS } from "../public/src/core/webrtc-transport.js";
import { ConnectionManager } from "../public/src/core/connection-manager.js";
import { calculateFrameTransform } from "../public/src/render/projection.js";

test("NaN repair preserves text, escaped quotes and backslashes, including in invalid numeric JSON", () => {
  const text = 'NaN Avenue \\ "NaN"';
  assert.equal(parseTelemetryJson(JSON.stringify({ text })).text, text);
  const raw = `{"text":${JSON.stringify(text)},"value":NaN,"values":[NaN,2]}`;
  assert.deepEqual(parseTelemetryJson(raw), { text, value: null, values: [null, 2] });
  assert.throws(() => parseTelemetryJson('{"value":notNaN}'));
});

test("incomplete/oversized telemetry is bounded and subsequent valid packets recover", () => {
  const discarded = [], store = new TelemetryStore();
  const adapter = new CerealAdapter(store, { maxBuffer: 128, onDiscard: (message) => discarded.push(message) });
  assert.ok(MAX_TELEMETRY_BUFFER >= 1024 * 1024);
  adapter.apply('{"unterminated":"' + "x".repeat(100));
  const message = JSON.stringify({ type: "carState", data: { vEgo: 12 } });
  assert.equal(adapter.apply(message), 1);
  assert.equal(store.state.vEgo, 12);
  assert.equal(discarded.length, 1);
  assert.equal(adapter.apply("x".repeat(129)), 0);
  assert.equal(adapter.buffer.length, 0);
  adapter.apply(message.slice(0, 15));
  assert.equal(adapter.apply(message.slice(15)), 1);
  assert.deepEqual([...adapter.lastAppliedTypes], ["carState"]);
  adapter.reset();
  assert.equal(adapter.lastAppliedTypes.size, 0);
});

test("overlay ignores unrelated telemetry, coalesces relevant data, and refreshes on reset/resize", (t) => {
  let callback, scheduled = 0, clears = 0;
  const globals = { window: { devicePixelRatio: 1 }, ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame(fn) { scheduled++; callback = fn; return 1; }, cancelAnimationFrame() { callback = null; } };
  for (const [key, value] of Object.entries(globals)) {
    const previous = globalThis[key]; globalThis[key] = value;
    t.after(() => { if (previous === undefined) delete globalThis[key]; else globalThis[key] = previous; });
  }
  let bounds = { width: 1280, height: 480 };
  const canvas = { getBoundingClientRect: () => bounds, getContext: () => ({ setTransform() {}, clearRect() { clears++; } }) };
  const store = new TelemetryStore(), video = { style: {} };
  const renderer = new OverlayRenderer(canvas, store, video);
  applyTelemetry(store, "deviceState", { deviceType: "", started: false, cpuTempC: [60] });
  applyTelemetry(store, "liveMapDataSP", { roadName: "Avenue" });
  applyTelemetry(store, "carState", { vEgo: 20 });
  assert.equal(scheduled, 0);
  applyTelemetry(store, "radarState", { leadOne: { status: true, dRel: 30 } });
  applyTelemetry(store, "longitudinalPlan", { allowThrottle: false });
  assert.equal(scheduled, 1); callback();
  const relevantCount = scheduled;
  applyTelemetry(store, "carOutput", { actuatorsOutput: { torque: .5 } });
  assert.equal(scheduled, relevantCount, "torque animation does not redraw the road projection");
  applyTelemetry(store, "selfdriveState", { enabled: true, experimentalMode: true }); callback();
  assert.ok(scheduled > relevantCount, "engagement/experimental colors still repaint");
  applyTelemetry(store, "extrinsicsCalibration", { rpyCalib: [0, .02, 0], calStatus: "calibrated" }); callback();
  applyTelemetry(store, "modelV2", {}); callback();
  const count = clears;
  store.update((state) => { state.hudLayout = "enhanced"; }); callback();
  assert.ok(clears > count, "preset affects clipping and projection");
  store.resetTelemetry(); callback();
  renderer.setPresentation("compact", false);
  const compactClears = clears;
  applyTelemetry(store, "radarState", { leadOne: { status: true } }); callback();
  assert.equal(clears, compactClears, "compact mode does not repeatedly clear the overlay");
  renderer.setPresentation("full", false);
  const fullClears = clears;
  renderer.setPresentation("full", false); assert.equal(clears, fullClears);
  bounds = { width: 844, height: 390 }; renderer.resize();
  assert.equal(canvas.width, 844); assert.ok(clears > fullClears);
  renderer.setPresentation("full", true);
  const scheduledBefore = scheduled;
  applyTelemetry(store, "modelV2", {}); assert.equal(scheduled, scheduledBefore);
  renderer.destroy();
});

test("handoff keeps rendering new overlay data in the visible camera geometry until release", (t) => {
  const globals={window:{devicePixelRatio:1},ResizeObserver:class{observe(){}disconnect(){}},
    requestAnimationFrame(fn){callback=fn;return 1;},cancelAnimationFrame(){}};
  let callback,clears=0;
  for(const [key,value] of Object.entries(globals)) {
    const previous=globalThis[key];globalThis[key]=value;
    t.after(()=>{if(previous===undefined)delete globalThis[key];else globalThis[key]=previous;});
  }
  let bounds={width:1199,height:498};
  const canvas={getBoundingClientRect:()=>bounds,getContext:()=>({setTransform(){},clearRect(){clears++;}})};
  const store=new TelemetryStore(),video={style:{}};
  const renderer=new OverlayRenderer(canvas,store,video);
  const expected=(streamType)=> {
    const frame=calculateFrameTransform({...store.state,streamType},bounds.width,bounds.height);
    return Object.fromEntries(["left","top","width","height"].map(key=>[key,`${frame[key]}px`]));
  };
  renderer.holdCamera(); store.update(s=>{s.streamType="wideRoad";}); callback();
  assert.deepEqual(video.style,expected("road"));
  const before=clears;
  applyTelemetry(store,"radarState",{leadOne:{status:true,dRel:20}});callback();
  assert.ok(clears>before,"relevant telemetry continues to repaint while camera geometry is held");
  assert.deepEqual(video.style,expected("road"));
  bounds={width:844,height:390};renderer.resize();assert.deepEqual(video.style,expected("road"));
  renderer.releaseCamera();assert.deepEqual(video.style,expected("wideRoad"));
  renderer.setPresentation("camera",false);renderer.holdCamera();renderer.releaseCamera();
  renderer.setPresentation("full",false);assert.deepEqual(video.style,expected("wideRoad"));
  renderer.destroy();
});

test("ordinary widget paints preserve geometry while live visibility remains responsive", () => {
  let writes = 0;
  const state = createInitialState(), layout = createPresetLayout("enhanced");
  const surface = { querySelector: () => null, __renderedHtml: "" };
  const element = { hidden: false, style: { setProperty() { writes++; } }, classList: { toggle() {} }, querySelector: () => surface };
  const manager = Object.assign(Object.create(WidgetManager.prototype), {
    layer: { dataset: {} }, elements: new Map([["roadName", element]]), store: { state },
    layout, presentedLayout: layout, collapsed: new Set(), editing: false, activeLayout: "enhanced", displayMode: "full", bounds: { width: 1280, height: 480 }
  });
  manager.render(); assert.equal(element.hidden, true);
  state.roadNameToggle = true; state.roadName = "NaN Avenue";
  manager.render(); assert.equal(element.hidden, false);
  assert.match(surface.innerHTML, /NaN Avenue/);
  assert.equal(writes, 0, "telemetry paints never reapply layout styles");
  layout.roadName.x = 12; manager.applyLayout("roadName"); assert.equal(writes, 4, "explicit layout updates still apply geometry");
  state.roadName = ""; manager.render(); assert.equal(element.hidden, true);
});

// A minimal SVG fixture exercises actual element updates without another DOM dependency.
function indicatorSurface() {
  class Node {
    constructor(tag, attributes = {}) { this.tag = tag; this.attributes = { ...attributes }; this.children = []; this.ownerDocument = { createElementNS: (_, tag) => new Node(tag) }; }
    getAttribute(name) { return this.attributes[name] ?? null; }
    setAttribute(name, value) { this.attributes[name] = value; }
    append(node) { this.children.push(node); }
    insertBefore(node, sibling) { this.children.splice(this.children.indexOf(sibling), 0, node); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) { return this.children.filter((node) => selector.startsWith("[fill=") ? node.getAttribute("fill") === "url(#confidence-gradient)" : node.tag === selector); }
  }
  return { writes: 0, set innerHTML(html) {
    this.writes++;
    const nodes = [...html.matchAll(/<(svg|path|circle|stop)\b([^>]*)>/g)].map((match) => new Node(match[1],
      Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((attribute) => [attribute[1], attribute[2]]))));
    this.svg = nodes[0]; this.svg.children = nodes.slice(1);
  }, querySelector() { return this.svg; } };
}

test("torque SVG nodes persist through zero, both directions, saturation and disengagement", () => {
  const surface = indicatorSurface(), state = createInitialState();
  paintIndicator(surface, "torque", state);
  const nodes = surface.__indicatorNodes;
  for (const status of ["engaged", "latOnly", "disengaged"]) for (const value of [0, .001, -.001, .6, -.9, 1]) {
    state.status = status; state.torqueDisplayValue = value;
    paintIndicator(surface, "torque", state);
    const expected = torquePresentation(value, status);
    assert.equal(surface.__indicatorNodes, nodes);
    assert.equal(nodes.fill.getAttribute("d"), expected.foreground);
    assert.equal(nodes.fill.getAttribute("stroke"), expected.fill);
    assert.equal(nodes.background.getAttribute("stroke-width"), String(expected.thickness));
    assert.equal(nodes.fill.getAttribute("display"), expected.showFill ? "inline" : "none");
    assert.equal(nodes.dot.getAttribute("display"), expected.showDot ? "inline" : "none");
    assert.equal(nodes.svg.getAttribute("aria-label"), expected.label);
  }
  assert.equal(surface.writes, 1);
});

test("confidence SVG persists across inactive/live states and all color thresholds", () => {
  const surface = indicatorSurface(), state = createInitialState();
  paintIndicator(surface, "confidence", state);
  const nodes = surface.__indicatorNodes;
  for (const status of ["engaged", "disengaged"]) for (const value of [0, .1, .3, .7, 1]) {
    state.status = status; state.confidenceSeen = true; state.confidenceFiltered = value;
    paintIndicator(surface, "confidence", state);
    const expected = confidencePresentation(state);
    assert.equal(nodes.ball.getAttribute("r"), String(expected.radius));
    assert.equal(nodes.ball.getAttribute("display"), expected.live ? "inline" : "none");
    assert.deepEqual(nodes.stops.map((node) => node.getAttribute("stop-color")), expected.colors);
    assert.equal(nodes.svg.getAttribute("aria-label"), expected.label);
  }
  assert.equal(surface.writes, 1);
});

test("only parsed core telemetry establishes readiness; stale warnings recover without reconnecting", async () => {
  const video = { srcObject: null }, transport = new WebRTCTransport(video), store = new TelemetryStore();
  const adapter = new CerealAdapter(store);
  new ConnectionManager({ transport, store, adapter, discovery: {} });
  const channel = Object.assign(new EventTarget(), { binaryType: "", readyState: "connecting", close() {} });
  transport.attachChannel(channel, transport.generation);
  transport.readiness.dataChannelOpen = true;
  transport.readiness.videoReady = true;
  channel.dispatchEvent(new MessageEvent("message", { data: '{"type":"clockSync","data":{"action":"pong"}}' }));
  assert.equal(transport.readiness.dataReceived, false);
  await assert.rejects(transport.waitForStreams(transport.generation, 0), (error) => {
    assert.match(error.message, /carState\/modelV2/);
    assert.match(error.cause.message, /carState, modelV2/);
    assert.equal(error.retryable, true);
    return true;
  });
  channel.dispatchEvent(new MessageEvent("message", { data: '{"type":"unknown","data":{}}' }));
  assert.equal(transport.readiness.dataReceived, false);
  channel.dispatchEvent(new MessageEvent("message", { data: '{"type":"carState","data":{"vEgo":20}}' }));
  assert.equal(transport.readiness.dataReceived, false);
  channel.dispatchEvent(new MessageEvent("message", { data: '{"type":"modelV2","data":{"position":{"x":[0,10],"y":[0,0],"z":[0,0]}}}' }));
  assert.equal(transport.readiness.dataReceived, true);
  await transport.waitForStreams(transport.generation, 100);
  transport.markTelemetryReceived(["carState"], 100000);
  assert.equal(transport.readiness.dataReceived, false, "old model data cannot satisfy initial readiness");
  transport.markTelemetryReceived(["modelV2"], 100001);
  assert.equal(transport.readiness.dataReceived, true);
  const events = [];
  transport.addEventListener("health", (event) => events.push(event.detail.staleServices));
  transport.lastTelemetry = new Map([["carState", 0], ["modelV2", 0]]);
  transport.healthGraceUntil = 0;
  transport.checkTelemetryHealth(TELEMETRY_STALE_MS); assert.equal(events.length, 0);
  transport.checkTelemetryHealth(TELEMETRY_STALE_MS + 1); assert.deepEqual(events.at(-1), ["carState", "modelV2"]);
  transport.checkTelemetryHealth(TELEMETRY_STALE_MS + 2); assert.equal(events.length, 1, "no repeated warning spam");
  transport.markTelemetryReceived(["carState"], 6000); assert.deepEqual(events.at(-1), ["modelV2"]);
  transport.markTelemetryReceived(["modelV2"], 6001); assert.deepEqual(events.at(-1), []);
  transport.resumeTelemetryHealth(10000); transport.checkTelemetryHealth(11000);
  assert.deepEqual(events.at(-1), [], "background return has a five-second grace period");
  transport.checkTelemetryHealth(15001); assert.equal(events.at(-1).length, 2);
  await transport.close(); assert.deepEqual(events.at(-1), []);
  assert.equal(transport.lastTelemetry.size, 0); assert.equal(transport.healthTimer, null);
});
