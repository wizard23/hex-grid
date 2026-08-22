import test from "node:test";
import assert from "node:assert/strict";
import { cellCenter, cellVertex, toWorld } from "./geometry";
import type { GridShape } from "./settings";
import { hitSpoke } from "./hit";

const shape: GridShape = { columns: 3, rows: 3, side: 10, orientationDeg: 25 };

test("hitSpoke finds the spoke a point lies on, in any orientation", () => {
  for (let col = 0; col < shape.columns; col++) {
    for (let row = 0; row < shape.rows; row++) {
      const c = cellCenter(shape, col, row);
      for (let k = 0; k < 6; k++) {
        const v = cellVertex(shape, col, row, k);
        const onSpoke = toWorld(shape, { x: c.x + (v.x - c.x) * 0.6, y: c.y + (v.y - c.y) * 0.6 });
        assert.deepEqual(hitSpoke(shape, onSpoke, 0.5), { col, row, k });
      }
    }
  }
});

test("hitSpoke is null away from spokes and outside the grid", () => {
  // midway between spokes 0 and 1 at 60% radius: 0.6·sin(30°)·10 = 3 mm from either
  const c = cellCenter(shape, 1, 1);
  const a = (30 * Math.PI) / 180;
  const between = toWorld(shape, { x: c.x + 6 * Math.cos(a), y: c.y + 6 * Math.sin(a) });
  assert.equal(hitSpoke(shape, between, 1), null);
  assert.notEqual(hitSpoke(shape, between, 3.1), null);
  assert.equal(hitSpoke(shape, { x: -500, y: -500 }, 5), null);
});
