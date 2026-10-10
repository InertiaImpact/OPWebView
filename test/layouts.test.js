import test from "node:test";
import assert from "node:assert/strict";
import { BUILT_IN_LAYOUTS, createPresetLayout, sanitizeLayoutName } from "../public/src/widgets/layout-presets.js";
import { WIDGETS } from "../public/src/widgets/widget-catalog.js";

test("ships Classic, Enhanced, and Detailed OPView presets", () => {
  assert.deepEqual(Object.keys(BUILT_IN_LAYOUTS), ["classic", "enhanced", "detailed"]);
  for (const id of Object.keys(BUILT_IN_LAYOUTS)) {
    const layout = createPresetLayout(id);
    assert.equal(Object.keys(layout).length, WIDGETS.length);
    assert.ok(Object.values(layout).some((item) => !item.hidden));
  }
});

test("Enhanced recalls the source layout's steering, lead, driver, confidence, and torque widgets", () => {
  const layout = createPresetLayout("enhanced");
  for (const id of ["speed", "cruise", "speedLimit", "driver", "confidence", "steering", "lead", "torque"]) {
    assert.equal(layout[id].hidden, false, id);
  }
  assert.equal(layout.detailedSteering.hidden, true);
});

test("custom layout names are trimmed and bounded", () => {
  assert.equal(sanitizeLayoutName("  Road   trip  "), "Road trip");
  assert.equal(sanitizeLayoutName("x".repeat(60)).length, 40);
});
