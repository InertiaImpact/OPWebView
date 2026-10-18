import test from "node:test";
import assert from "node:assert/strict";
import { extractJsonObjects } from "../public/src/core/telemetry-adapter.js";
import { createInitialState, TelemetryStore } from "../public/src/core/state.js";
import { CerealAdapter } from "../public/src/core/telemetry-adapter.js";
import { WIDGETS } from "../public/src/widgets/widget-catalog.js";

const health = (state) => WIDGETS.find(({id}) => id === "deviceHealth").render(state);
const signalCell = (html, label) => html.match(new RegExp(`${label}</span><strong[^>]*>([\\s\\S]*?)</strong>`))[1];

test("cellular signal replaces calibration and never repeats Wi-Fi strength", () => {
  const store = new TelemetryStore();
  const adapter = new CerealAdapter(store);
  const update = (data) => adapter.apply(JSON.stringify({type:"deviceState",data}));
  update({networkType:"wifi",networkStrength:"great"});
  assert.equal(store.state.networkType,"wifi");
  assert.match(signalCell(health(store.state),"Wi-Fi"), /Wi-Fi great signal/);
  assert.equal(signalCell(health(store.state),"CELL"),"–");
  assert.doesNotMatch(health(store.state),/CALIB/);
  update({networkType:"cell4G",networkStrength:"moderate"});
  assert.equal(signalCell(health(store.state),"Wi-Fi"),"–");
  const cell = signalCell(health(store.state),"CELL");
  assert.match(cell,/Cellular moderate signal/);
  assert.equal([...cell.matchAll(/class="lit"/g)].length,2);
  update({networkType:"none",networkStrength:"unknown"});
  assert.equal(signalCell(health(store.state),"CELL"),"–");
  assert.equal(signalCell(health(store.state),"Wi-Fi"),"–");
  update({networkStrength:"great"});
  assert.equal(store.state.networkType,"unknown");
  assert.equal(signalCell(health(store.state),"CELL"),"–");
  assert.equal(signalCell(health(store.state),"Wi-Fi"),"–");
});

test("cell signal supports all published cellular types and unknown readings stay unavailable", () => {
  for (const networkType of ["cell2G","cell3G","cell4G","cell5G"]) {
    for (const [networkStrength, bars] of [["poor",1],["moderate",2],["good",3],["great",4]]) {
      const state = {...createInitialState(),deviceSeen:true,networkType,networkStrength};
      assert.equal([...signalCell(health(state),"CELL").matchAll(/class="lit"/g)].length,bars);
      assert.equal(signalCell(health(state),"Wi-Fi"),"–");
    }
  }
  for (const state of [createInitialState(),{deviceSeen:true,networkType:"cell4G",networkStrength:"unknown"},
    {deviceSeen:true,networkType:"ethernet",networkStrength:"great"}]) {
    assert.equal(signalCell(health(state),"CELL"),"–");
    assert.equal(signalCell(health(state),"Wi-Fi"),"–");
  }
});

test("extracts concatenated telemetry objects", () => {
  const input = '{"type":"carState","data":{"vEgo":1}}{"type":"modelV2","data":{}}';
  const result = extractJsonObjects(input);
  assert.equal(result.objects.length, 2);
  assert.equal(result.remainder, "");
});

test("preserves a fragmented object for the next data-channel chunk", () => {
  const result = extractJsonObjects('{"type":"carState","data":{"vEgo":');
  assert.deepEqual(result.objects, []);
  assert.equal(result.remainder, '{"type":"carState","data":{"vEgo":');
});

test("ignores braces inside JSON strings", () => {
  const input = '{"type":"selfdriveState","data":{"alertText1":"Look }{ ahead"}}';
  const result = extractJsonObjects(input);
  assert.equal(result.objects.length, 1);
  assert.equal(JSON.parse(result.objects[0]).data.alertText1, "Look }{ ahead");
});

test("maps Enhanced and Detailed layout telemetry", () => {
  const store = new TelemetryStore(createInitialState());
  const adapter = new CerealAdapter(store);
  adapter.apply([
    { type: "carState", data: { steeringAngleDeg: -12.5, aEgo: -0.4, gearShifter: "drive", cruiseState: { enabled: true } } },
    { type: "controlsState", data: { curvature: 0.002, desiredCurvature: 0.003, lateralControlState: { torqueState: { saturated: true } } } },
    { type: "carControl", data: { latActive: true, longActive: true, actuators: { accel: -0.6, steeringAngleDeg: 7.5 } } },
    { type: "driverMonitoringState", data: { activePolicy: "vision", visionPolicyState: { faceDetected: true, awarenessPercent: 82, pose: {} } } },
    { type: "deviceState", data: { cpuTempC: [55, 62], memoryUsagePercent: 48, powerDrawW: 6.1 } },
    { type: "liveMapDataSP", data: { roadName: "Cam Fella Boulevard", speedLimitAheadValid: true, speedLimitAhead: 20 } }
  ].map(JSON.stringify).join(""));

  assert.equal(store.state.steeringAngleDeg, -12.5);
  assert.equal(store.state.lateralSaturated, true);
  assert.equal(store.state.targetSteeringAngleDeg, 7.5);
  assert.equal(store.state.dmFaceDetected, true);
  assert.equal(store.state.cpuTempC, 62);
  assert.equal(store.state.roadName, "Cam Fella Boulevard");
});
