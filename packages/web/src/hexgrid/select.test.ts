import test from "node:test";
import assert from "node:assert/strict";
import { canonicalEdge, canonicalVertex, cellCenter, cellVertex, toWorld } from "./geometry";
import type { GridShape } from "./settings";
import { cellPolygonPath, centrePoint, nearestCentre, toStampCentre } from "./select";

const shape: GridShape = { columns: 3, rows: 3, side: 10, orientationDeg: 20 };

test("nearestCentre snaps to cell centres, corners and edge midpoints, canonically", () => {
  const c = cellCenter(shape, 1, 1);
  assert.deepEqual(nearestCentre(shape, toWorld(shape, { x: c.x + 1, y: c.y - 1 })), { type: "cell", col: 1, row: 1, k: 0 });
  for (let k = 0; k < 6; k++) {
    const v = cellVertex(shape, 1, 1, k);
    const nearV = nearestCentre(shape, toWorld(shape, { x: v.x + (c.x - v.x) * 0.05, y: v.y + (c.y - v.y) * 0.05 }));
    assert.deepEqual(nearV, { type: "vertex", ...canonicalVertex(shape, 1, 1, k) });
    const w = cellVertex(shape, 1, 1, k + 1);
    const m = { x: (v.x + w.x) / 2, y: (v.y + w.y) / 2 };
    const nearM = nearestCentre(shape, toWorld(shape, { x: m.x + (c.x - m.x) * 0.05, y: m.y + (c.y - m.y) * 0.05 }));
    assert.deepEqual(nearM, { type: "edge", ...canonicalEdge(shape, 1, 1, k) });
  }
  assert.equal(nearestCentre(shape, { x: -500, y: -500 }), null);
});

test("centrePoint returns the picked point and stamp centres are anchor-relative", () => {
  const ref = nearestCentre(shape, toWorld(shape, cellVertex(shape, 1, 1, 2)));
  assert.ok(ref);
  const p = centrePoint(shape, ref);
  const expected = toWorld(shape, cellVertex(shape, 1, 1, 2));
  assert.ok(Math.hypot(p.x - expected.x, p.y - expected.y) < 1e-9);
  // axial(2,2) = (2,1), axial(1,1) = (1,1) → offset (1,0)
  const rel = toStampCentre({ type: "cell", col: 2, row: 2, k: 0 }, { col: 1, row: 1 });
  assert.deepEqual(rel, { type: "cell", dq: 1, dr: 0, k: 0 });
});

test("cellPolygonPath draws one closed hexagon per cell", () => {
  const d = cellPolygonPath(shape, [{ col: 0, row: 0 }, { col: 1, row: 2 }]);
  assert.equal(d.split("M").length - 1, 2);
  assert.equal(d.split("Z").length - 1, 2);
});
