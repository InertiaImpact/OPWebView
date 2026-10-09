import test from "node:test";
import assert from "node:assert/strict";
import { extractJsonObjects } from "../public/src/core/telemetry-adapter.js";

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
