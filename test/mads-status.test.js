import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { TelemetryStore, applyTelemetry } from "../public/src/core/state.js";

// rx-wb-stg UIStateSP.update_status, verified at 7dd9234.
const cases = [
  ["neither control", false, false, true, "enabled", "disabled", false, "disengaged"],
  ["steering only", false, true, true, "enabled", "enabled", false, "latOnly"],
  ["cruise only", true, false, true, "enabled", "disabled", false, "longOnly"],
  ["both controls", true, true, true, "enabled", "enabled", false, "engaged"],
  ["pre-enabled takes priority", true, true, true, "preEnabled", "enabled", false, "override"],
  ["paused takes priority", true, true, true, "enabled", "paused", false, "override"],
  ["MADS override takes priority", true, true, true, "enabled", "overriding", false, "override"],
  ["longitudinal override", true, true, true, "overriding", "enabled", true, "override"],
  ["no MADS during override", true, false, false, "overriding", "disabled", false, "override"],
  ["other override retains both controls", true, true, true, "overriding", "enabled", false, "engaged"],
  ["other override retains steering only", false, true, true, "overriding", "enabled", false, "latOnly"],
  ["event alone is not an override", true, true, true, "enabled", "enabled", true, "engaged"],
  ["MADS unavailable uses enabled", true, true, false, "enabled", "enabled", false, "engaged"],
  ["MADS unavailable uses disabled", false, true, false, "disabled", "enabled", false, "disengaged"],
];

test("MADS state precedence matches rx-wb-stg regardless of service arrival order", () => {
  for (const [name, enabled, madsEnabled, available, state, madsState, override, expected] of cases) {
    const packets = [
      ["selfdriveState", { enabled, state }],
      ["selfdriveStateSP", { mads: { enabled: madsEnabled, available, state: madsState } }],
      ["onroadEvents", [{ overrideLongitudinal: override }]],
    ];
    for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
      const store = new TelemetryStore();
      for (const index of order) applyTelemetry(store, ...packets[index]);
      assert.equal(store.state.status, expected, `${name}: ${order}`);
    }
  }
});

test("clearing longitudinal override restores the current MADS state", () => {
  const store = new TelemetryStore();
  applyTelemetry(store, "selfdriveState", { enabled: true, state: "overriding" });
  applyTelemetry(store, "selfdriveStateSP", { mads: { enabled: true, available: true, state: "enabled" } });
  applyTelemetry(store, "onroadEvents", [{ overrideLongitudinal: true }]);
  assert.equal(store.state.status, "override");
  applyTelemetry(store, "onroadEvents", []);
  assert.equal(store.state.status, "engaged");
  applyTelemetry(store, "selfdriveState", { enabled: false, state: "disabled" });
  assert.equal(store.state.status, "latOnly");
});

test("legacy streams without MADS preserve their status mapping", () => {
  const store = new TelemetryStore();
  for (const [state, enabled, expected] of [
    ["disabled", false, "disengaged"], ["enabled", true, "engaged"],
    ["preEnabled", true, "override"], ["overriding", true, "override"],
  ]) {
    applyTelemetry(store, "selfdriveState", { enabled, state });
    assert.equal(store.state.status, expected);
  }
});

test("MADS frame colors match native and do not change angle/torque colors", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  for (const [state, color] of [["latOnly", "00c8c8"], ["longOnly", "961ca8"], ["override", "89928d"]]) {
    assert.ok(css.includes(`.app[data-drive-state="${state}"] { --frame: #${color}; }`));
  }
  assert.ok(css.includes('.data-row strong.angle { color: #3adb6d; }'));
  assert.ok(css.includes('.data-row strong.torque { color: #4d9dff; }'));
});
