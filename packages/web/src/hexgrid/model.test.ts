import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_SPOKES,
  createModel,
  fillModel,
  hasSpoke,
  modelFromBytes,
  resizeModel,
  spokesOf,
  toggleSpoke,
} from "./model";

test("toggleSpoke flips one bit and leaves the original untouched", () => {
  const m = createModel(3, 2);
  const on = toggleSpoke(m, 1, 1, 4);
  assert.equal(hasSpoke(on, 1, 1, 4), true);
  assert.equal(hasSpoke(m, 1, 1, 4), false);
  assert.equal(spokesOf(on, 1, 1), 1 << 4);
  const off = toggleSpoke(on, 1, 1, 4);
  assert.equal(spokesOf(off, 1, 1), 0);
});

test("fillModel presets every cell", () => {
  const m = fillModel(createModel(2, 2), ALL_SPOKES);
  assert.deepEqual([...m.spokes], [63, 63, 63, 63]);
});

test("resizeModel keeps the cells that still exist", () => {
  let m = createModel(3, 3);
  m = toggleSpoke(m, 2, 2, 0);
  m = toggleSpoke(m, 0, 1, 5);
  const smaller = resizeModel(m, 2, 2);
  assert.equal(smaller.spokes.length, 4);
  assert.equal(hasSpoke(smaller, 0, 1, 5), true);
  const bigger = resizeModel(m, 4, 5);
  assert.equal(hasSpoke(bigger, 2, 2, 0), true);
  assert.equal(hasSpoke(bigger, 0, 1, 5), true);
  assert.equal(spokesOf(bigger, 3, 4), 0);
  assert.equal(resizeModel(m, 3, 3), m);
});

test("modelFromBytes masks to six bits", () => {
  const m = modelFromBytes(2, 1, [255, 5]);
  assert.deepEqual([...m.spokes], [63, 5]);
});
