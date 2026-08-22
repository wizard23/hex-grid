import test from "node:test";
import assert from "node:assert/strict";
import { neighbour } from "./geometry";
import {
  ALL_LINES,
  createModel,
  fillModel,
  hasEdge,
  hasSpoke,
  modelFromBytes,
  resizeModel,
  spokesOf,
  toggleEdge,
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

test("edges default to drawn and toggle consistently from both neighbouring cells", () => {
  const m = createModel(3, 3);
  assert.equal(hasEdge(m, 1, 1, 0), true);
  const partner = neighbour(m, 1, 1, 0); // shares the edge as its edge 3
  assert.ok(partner);
  const off = toggleEdge(m, 1, 1, 0);
  assert.equal(hasEdge(off, 1, 1, 0), false);
  assert.equal(hasEdge(off, partner.col, partner.row, 3), false);
  assert.equal(hasEdge(m, 1, 1, 0), true, "original untouched");
  const back = toggleEdge(off, partner.col, partner.row, 3);
  assert.equal(hasEdge(back, 1, 1, 0), true);
  assert.deepEqual([...back.edges], [...m.edges]);
});

test("fillModel presets spokes and edges", () => {
  const m = fillModel(createModel(2, 2), ALL_LINES, 0);
  assert.deepEqual([...m.spokes], [63, 63, 63, 63]);
  assert.deepEqual([...m.edges], [0, 0, 0, 0]);
});

test("resizeModel keeps the cells that still exist", () => {
  let m = createModel(3, 3);
  m = toggleSpoke(m, 2, 2, 0);
  m = toggleSpoke(m, 0, 1, 5);
  m = toggleEdge(m, 0, 0, 1);
  const smaller = resizeModel(m, 2, 2);
  assert.equal(smaller.spokes.length, 4);
  assert.equal(hasSpoke(smaller, 0, 1, 5), true);
  assert.equal(hasEdge(smaller, 0, 0, 1), false);
  const bigger = resizeModel(m, 4, 5);
  assert.equal(hasSpoke(bigger, 2, 2, 0), true);
  assert.equal(hasSpoke(bigger, 0, 1, 5), true);
  assert.equal(hasEdge(bigger, 0, 0, 1), false);
  assert.equal(spokesOf(bigger, 3, 4), 0);
  assert.equal(hasEdge(bigger, 3, 4, 0), true, "new cells get all edges");
  assert.equal(resizeModel(m, 3, 3), m);
});

test("modelFromBytes masks to six bits and defaults edges to drawn", () => {
  const m = modelFromBytes(2, 1, [255, 5], undefined);
  assert.deepEqual([...m.spokes], [63, 5]);
  assert.deepEqual([...m.edges], [63, 63]);
  assert.deepEqual([...modelFromBytes(2, 1, [0, 0], [1, 2]).edges], [1, 2]);
});
