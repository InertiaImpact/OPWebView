import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState, TelemetryStore, applyTelemetry, torqueBarValue } from "../public/src/core/state.js";
import { IndicatorSmoother } from "../public/src/widgets/indicator-smoothing.js";
import { torqueGraph } from "../public/src/widgets/widget-graphs.js";
import { WidgetManager } from "../public/src/widgets/widget-manager.js";

test("torque smooths at the comma time constant without changing raw telemetry", () => {
  const state = createInitialState(), smoother = new IndicatorSmoother();
  state.torqueOutput = -.3;
  smoother.sample(state, 0);
  const sample = smoother.sample(state, 100);
  assert.ok(Math.abs(sample.torqueDisplayValue - .3 * (1 - Math.exp(-1))) < 1e-10);
  assert.equal(state.torqueOutput, -.3);
  assert.equal(torqueBarValue(state), .3);
  state.torqueOutput = .3;
  const next = smoother.sample(state, 150);
  assert.ok(next.torqueDisplayValue < sample.torqueDisplayValue);
  assert.ok(next.torqueDisplayValue > -.3, "no reversal overshoot");
});

test("animation is independent of paint rate and interpolates filtered confidence", () => {
  const state = createInitialState(), a = new IndicatorSmoother(), b = new IndicatorSmoother();
  a.sample(state, 0); b.sample(state, 0);
  state.torqueOutput = -.1; state.confidenceFiltered = .2;
  let many;
  for (let time = 10; time <= 100; time += 10) many = a.sample(state, time);
  const one = b.sample(state, 100);
  assert.ok(Math.abs(one.torqueDisplayValue - many.torqueDisplayValue) < 1e-10);
  assert.ok(Math.abs(one.confidenceFiltered - many.confidenceFiltered) < 1e-10);
  assert.ok(one.confidenceFiltered > .2 && one.confidenceFiltered < 1);
  assert.equal(state.confidenceFiltered, .2);
});

test("resume does not integrate the background gap and a new session resets smoothing", () => {
  const state = createInitialState(), smoother = new IndicatorSmoother();
  state.torqueOutput = -.5;
  smoother.sample(state, 0);
  const before = smoother.sample(state, 100);
  smoother.pause();
  assert.equal(smoother.sample(state, 60000).torqueDisplayValue, before.torqueDisplayValue);
  assert.equal(smoother.sample(createInitialState(), 60100).torqueDisplayValue, 0);
});

test("minimum rounded nonzero torque is drawn, while true zero has no fill", () => {
  assert.equal((torqueGraph(.001, "engaged").match(/<path /g) || []).length, 2);
  assert.equal((torqueGraph(-.001, "engaged").match(/<path /g) || []).length, 2);
  assert.equal((torqueGraph(0, "engaged").match(/<path /g) || []).length, 1);
});

test("rx-wb-stg slim messages at mixed rates retain torque and confidence inputs", () => {
  const store = new TelemetryStore();
  // Payload shapes retained by opview_slim.py at 7dd9234; no discarded fields.
  applyTelemetry(store, "selfdriveState", { enabled: true, state: "enabled" });
  applyTelemetry(store, "carControl", { latActive: true, longActive: true, actuators: {accel: .2, steeringAngleDeg: 2} });
  applyTelemetry(store, "controlsState", { curvature: 0, desiredCurvature: 0, lateralControlState: {torqueState: {saturated: false}} });
  applyTelemetry(store, "carOutput", {actuatorsOutput: {torque: .001, torqueOutputCan: 1}});
  applyTelemetry(store, "modelV2", {meta: {disengagePredictions: {brakeDisengageProbs: [.04, .08], steerOverrideProbs: [.02]}}});
  assert.equal(torqueBarValue(store.state), -.001);
  assert.equal(store.state.confidenceSeen, true);
  assert.ok(store.state.confidenceFiltered < 1);
  // On angle steering, rounding a gentle command to zero is unrecoverable.
  applyTelemetry(store, "controlsState", {desiredCurvature: 0, lateralControlState: {angleState: {saturated: false}}});
  assert.equal(torqueBarValue(store.state), 0, "never fabricate a small steering command");
});

test("indicator animation does not schedule work while hidden or in native video PiP", () => {
  const manager = Object.assign(Object.create(WidgetManager.prototype), {
    indicators: new IndicatorSmoother(), suspended: true, displayMode: "full", elements: new Map()
  });
  manager.scheduleIndicatorAnimation();
  manager.suspended = false; manager.displayMode = "camera";
  manager.scheduleIndicatorAnimation();
  manager.displayMode = "full";
  manager.scheduleIndicatorAnimation();
  assert.equal(manager.indicatorFrame, undefined);
});
