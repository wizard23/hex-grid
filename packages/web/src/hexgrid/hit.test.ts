import test from "node:test";
import assert from "node:assert/strict";
import { canonicalEdge, cellCenter, cellVertex, toWorld } from "./geometry";
import type { GridShape } from "./settings";
import { hitLine } from "./hit";

const shape: GridShape = { columns: 3, rows: 3, side: 10, orientationDeg: 25 };

test("hitLine finds the spoke a point lies on, in any orientation", () => {
  for (let col = 0; col < shape.columns; col++) {
    for (let row = 0; row < shape.rows; row++) {
      const c = cellCenter(shape, col, row);
      for (let k = 0; k < 6; k++) {
        const v = cellVertex(shape, col, row, k);
        const onSpoke = toWorld(shape, { x: c.x + (v.x - c.x) * 0.6, y: c.y + (v.y - c.y) * 0.6 });
        assert.deepEqual(hitLine(shape, onSpoke, 0.5), { kind: "spoke", col, row, k });
      }
    }
  }
});

test("hitLine finds hex edges by their canonical owner from either side", () => {
  for (let col = 0; col < shape.columns; col++) {
    for (let row = 0; row < shape.rows; row++) {
      for (let k = 0; k < 6; k++) {
        const a = cellVertex(shape, col, row, k);
        const b = cellVertex(shape, col, row, k + 1);
        const c = cellCenter(shape, col, row);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        // slightly inside this cell, off the edge midpoint
        const inside = toWorld(shape, { x: mid.x + (c.x - mid.x) * 0.05, y: mid.y + (c.y - mid.y) * 0.05 });
        assert.deepEqual(hitLine(shape, inside, 1), { kind: "edge", ...canonicalEdge(shape, col, row, k) });
      }
    }
  }
});

test("hitLine is null away from lines, picks the nearer kind, null outside the grid", () => {
  const c = cellCenter(shape, 1, 1);
  const a = (30 * Math.PI) / 180;
  // midway between spokes 0 and 1 at 4 mm: 2 mm from either spoke, 4.66 mm from the edge
  const nearSpokes = toWorld(shape, { x: c.x + 4 * Math.cos(a), y: c.y + 4 * Math.sin(a) });
  assert.equal(hitLine(shape, nearSpokes, 1), null);
  assert.equal(hitLine(shape, nearSpokes, 2.1)?.kind, "spoke");
  // at 6 mm: 3 mm from the spokes but only 2.66 mm from edge 0
  const nearEdge = toWorld(shape, { x: c.x + 6 * Math.cos(a), y: c.y + 6 * Math.sin(a) });
  assert.equal(hitLine(shape, nearEdge, 2.5), null);
  assert.equal(hitLine(shape, nearEdge, 2.7)?.kind, "edge");
  assert.equal(hitLine(shape, { x: -500, y: -500 }, 5), null);
});
