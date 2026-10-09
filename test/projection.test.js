import test from "node:test";
import assert from "node:assert/strict";
import { matmul3x3, matvec3, rotFromEuler, pathLengthIndex } from "../public/src/render/projection.js";

test("identity Euler rotation leaves a vector unchanged", () => {
  const rotation = rotFromEuler([0, 0, 0]);
  assert.deepEqual(matvec3(rotation, [3, 2, 1]), [3, 2, 1]);
});

test("3x3 multiplication composes transforms", () => {
  const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const matrix = [[2, 1, 0], [0, 3, 1], [1, 0, 4]];
  assert.deepEqual(matmul3x3(identity, matrix), matrix);
});

test("pathLengthIndex returns the last point not beyond the distance", () => {
  assert.equal(pathLengthIndex([0, 5, 10, 15], 11), 2);
});
