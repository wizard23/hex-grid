import test from "node:test";
import assert from "node:assert/strict";
import { canonicalEdge, canonicalVertex, cellCenter, cellVertex, toWorld } from "./geometry";
import { CENTRE } from "./model";
import type { GridShape } from "./settings";
import { hitElement } from "./hit";

const shape: GridShape = { columns: 3, rows: 3, side: 10, orientationDeg: 25 };
const NO_VERTEX = 0;

test("hitElement finds the spoke a point lies on, in any orientation", () => {
  for (let col = 0; col < shape.columns; col++) {
    for (let row = 0; row < shape.rows; row++) {
      const c = cellCenter(shape, col, row);
      for (let k = 0; k < 6; k++) {
        const v = cellVertex(shape, col, row, k);
        const onSpoke = toWorld(shape, { x: c.x + (v.x - c.x) * 0.6, y: c.y + (v.y - c.y) * 0.6 });
        assert.deepEqual(hitElement(shape, onSpoke, 0.5, NO_VERTEX), { kind: "spoke", col, row, k });
      }
    }
  }
});

test("hitElement finds hex edges by their canonical owner from either side", () => {
  for (let col = 0; col < shape.columns; col++) {
    for (let row = 0; row < shape.rows; row++) {
      for (let k = 0; k < 6; k++) {
        const a = cellVertex(shape, col, row, k);
        const b = cellVertex(shape, col, row, k + 1);
        const c = cellCenter(shape, col, row);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        // slightly inside this cell, off the edge midpoint
        const inside = toWorld(shape, { x: mid.x + (c.x - mid.x) * 0.05, y: mid.y + (c.y - mid.y) * 0.05 });
        assert.deepEqual(hitElement(shape, inside, 1, NO_VERTEX), { kind: "edge", ...canonicalEdge(shape, col, row, k) });
      }
    }
  }
});

test("hitElement prefers a vertex within the vertex radius, by canonical owner", () => {
  for (let col = 0; col < shape.columns; col++) {
    for (let row = 0; row < shape.rows; row++) {
      const c = cellCenter(shape, col, row);
      const nearCentre = toWorld(shape, { x: c.x + 0.4, y: c.y - 0.3 });
      assert.deepEqual(hitElement(shape, nearCentre, 1, 1), { kind: "vertex", col, row, k: CENTRE });
      assert.equal(hitElement(shape, nearCentre, 1, NO_VERTEX)?.kind, "spoke", "without a vertex radius the spoke wins");
      for (let k = 0; k < 6; k++) {
        const v = cellVertex(shape, col, row, k);
        const nearCorner = toWorld(shape, { x: v.x + (c.x - v.x) * 0.04, y: v.y + (c.y - v.y) * 0.04 });
        assert.deepEqual(hitElement(shape, nearCorner, 1, 1), { kind: "vertex", ...canonicalVertex(shape, col, row, k) });
      }
    }
  }
});

test("hitElement falls back to the triangle, picks the nearer line kind, null outside the grid", () => {
  const c = cellCenter(shape, 1, 1);
  const a = (30 * Math.PI) / 180;
  // midway between spokes 0 and 1 at 4 mm: 2 mm from either spoke, 4.66 mm from the edge
  const nearSpokes = toWorld(shape, { x: c.x + 4 * Math.cos(a), y: c.y + 4 * Math.sin(a) });
  assert.deepEqual(hitElement(shape, nearSpokes, 1, 1), { kind: "triangle", col: 1, row: 1, k: 0 });
  assert.equal(hitElement(shape, nearSpokes, 2.1, 1)?.kind, "spoke");
  // at 6 mm: 3 mm from the spokes but only 2.66 mm from edge 0
  const nearEdge = toWorld(shape, { x: c.x + 6 * Math.cos(a), y: c.y + 6 * Math.sin(a) });
  assert.deepEqual(hitElement(shape, nearEdge, 2.5, 1), { kind: "triangle", col: 1, row: 1, k: 0 });
  assert.equal(hitElement(shape, nearEdge, 2.7, 1)?.kind, "edge");
  assert.equal(hitElement(shape, { x: -500, y: -500 }, 5, 5), null);
});

test("hitElement names the triangle by its sector in every cell", () => {
  for (let col = 0; col < shape.columns; col++) {
    for (let row = 0; row < shape.rows; row++) {
      const c = cellCenter(shape, col, row);
      for (let t = 0; t < 6; t++) {
        const a = cellVertex(shape, col, row, t);
        const b = cellVertex(shape, col, row, t + 1);
        const centroid = toWorld(shape, { x: (c.x + a.x + b.x) / 3, y: (c.y + a.y + b.y) / 3 });
        assert.deepEqual(hitElement(shape, centroid, 1, 1), { kind: "triangle", col, row, k: t });
      }
    }
  }
});
