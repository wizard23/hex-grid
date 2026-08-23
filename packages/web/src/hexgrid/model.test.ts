import test from "node:test";
import assert from "node:assert/strict";
import { neighbour } from "./geometry";
import {
  ALL_LINES,
  ALL_VERTICES,
  CENTRE,
  createModel,
  fillLines,
  fillVertices,
  hasEdge,
  hasSpoke,
  hasVertex,
  modelFromBytes,
  resizeModel,
  spokesOf,
  toggleEdge,
  toggleSpoke,
  toggleVertex,
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

test("vertices default to hidden and toggle consistently from all cells sharing a corner", () => {
  const m = createModel(3, 3);
  assert.equal(hasVertex(m, 1, 1, CENTRE), false);
  assert.equal(hasVertex(m, 1, 1, 0), false);
  const centre = toggleVertex(m, 1, 1, CENTRE);
  assert.equal(hasVertex(centre, 1, 1, CENTRE), true);
  assert.equal(hasVertex(centre, 1, 1, 0), false);
  const across = neighbour(m, 1, 1, 0);
  const before = neighbour(m, 1, 1, 5);
  assert.ok(across && before);
  const corner = toggleVertex(m, across.col, across.row, 4); // same point as (1,1) corner 0
  assert.equal(hasVertex(corner, 1, 1, 0), true);
  assert.equal(hasVertex(corner, before.col, before.row, 2), true);
  assert.equal(hasVertex(m, 1, 1, 0), false, "original untouched");
  assert.deepEqual([...toggleVertex(corner, before.col, before.row, 2).vertices], [...m.vertices]);
});

test("fillLines presets spokes and edges, fillVertices the dots", () => {
  const m = fillLines(toggleVertex(createModel(2, 2), 0, 0, CENTRE), ALL_LINES, 0);
  assert.deepEqual([...m.spokes], [63, 63, 63, 63]);
  assert.deepEqual([...m.edges], [0, 0, 0, 0]);
  assert.deepEqual([...m.vertices], [1 << CENTRE, 0, 0, 0], "lines presets leave vertices alone");
  assert.deepEqual([...fillVertices(m, ALL_VERTICES).vertices], [127, 127, 127, 127]);
  assert.deepEqual([...fillVertices(m, ALL_VERTICES).spokes], [63, 63, 63, 63]);
});

test("resizeModel keeps the cells that still exist", () => {
  let m = createModel(3, 3);
  m = toggleSpoke(m, 2, 2, 0);
  m = toggleSpoke(m, 0, 1, 5);
  m = toggleEdge(m, 0, 0, 1);
  m = toggleVertex(m, 1, 1, CENTRE);
  const smaller = resizeModel(m, 2, 2);
  assert.equal(hasVertex(smaller, 1, 1, CENTRE), true);
  assert.equal(smaller.spokes.length, 4);
  assert.equal(hasSpoke(smaller, 0, 1, 5), true);
  assert.equal(hasEdge(smaller, 0, 0, 1), false);
  const bigger = resizeModel(m, 4, 5);
  assert.equal(hasSpoke(bigger, 2, 2, 0), true);
  assert.equal(hasSpoke(bigger, 0, 1, 5), true);
  assert.equal(hasEdge(bigger, 0, 0, 1), false);
  assert.equal(hasVertex(bigger, 1, 1, CENTRE), true);
  assert.equal(hasVertex(bigger, 3, 4, CENTRE), false, "new cells have no dots");
  assert.equal(spokesOf(bigger, 3, 4), 0);
  assert.equal(hasEdge(bigger, 3, 4, 0), true, "new cells get all edges");
  assert.equal(resizeModel(m, 3, 3), m);
});

test("modelFromBytes masks bits and defaults edges to drawn, vertices to hidden", () => {
  const m = modelFromBytes(2, 1, [255, 5], undefined, undefined);
  assert.deepEqual([...m.spokes], [63, 5]);
  assert.deepEqual([...m.edges], [63, 63]);
  assert.deepEqual([...m.vertices], [0, 0]);
  const full = modelFromBytes(2, 1, [0, 0], [1, 2], [255, 3]);
  assert.deepEqual([...full.edges], [1, 2]);
  assert.deepEqual([...full.vertices], [127, 3]);
});
