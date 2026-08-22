import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalEdge,
  cellAt,
  cellCenter,
  cellVertex,
  distanceToSegment,
  localBounds,
  neighbour,
  rotate,
  SQRT3,
  toLocal,
  toWorld,
  worldBounds,
} from "./geometry";
import type { GridShape } from "./settings";

const shape: GridShape = { columns: 4, rows: 3, side: 10, orientationDeg: 0 };

function near(a: number, b: number, eps = 1e-9) {
  assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
}

test("flat-top layout: odd columns shift down half a row", () => {
  assert.deepEqual(cellCenter(shape, 0, 0), { x: 0, y: 0 });
  near(cellCenter(shape, 1, 0).x, 15);
  near(cellCenter(shape, 1, 0).y, (SQRT3 / 2) * 10);
  near(cellCenter(shape, 2, 1).y, SQRT3 * 10);
});

test("vertex 0 is the pointy tip on the right", () => {
  const v = cellVertex(shape, 0, 0, 0);
  near(v.x, 10);
  near(v.y, 0);
});

test("neighbour across edge k is the cell sharing vertices k and k+1", () => {
  for (let col = 0; col < shape.columns; col++) {
    for (let row = 0; row < shape.rows; row++) {
      for (let k = 0; k < 6; k++) {
        const n = neighbour(shape, col, row, k);
        if (n === null) continue;
        const a = cellVertex(shape, col, row, k);
        const b = cellVertex(shape, col, row, k + 1);
        const na = cellVertex(shape, n.col, n.row, k + 4); // opposite edge k+3, reversed
        const nb = cellVertex(shape, n.col, n.row, k + 3);
        near(a.x, na.x);
        near(a.y, na.y);
        near(b.x, nb.x);
        near(b.y, nb.y);
      }
    }
  }
});

test("canonicalEdge names one owner per shared edge, from both sides", () => {
  assert.deepEqual(canonicalEdge(shape, 0, 0, 0), { col: 0, row: 0, k: 0 });
  assert.deepEqual(canonicalEdge(shape, 1, 0, 3), { col: 0, row: 0, k: 0 });
  // boundary edges stay with the cell
  assert.deepEqual(canonicalEdge(shape, 0, 0, 3), { col: 0, row: 0, k: 3 });
  for (let col = 0; col < shape.columns; col++) {
    for (let row = 0; row < shape.rows; row++) {
      for (let k = 0; k < 6; k++) {
        const n = neighbour(shape, col, row, k);
        if (n === null) continue;
        assert.deepEqual(canonicalEdge(shape, col, row, k), canonicalEdge(shape, n.col, n.row, k + 3));
      }
    }
  }
});

test("neighbour is null outside the grid", () => {
  assert.equal(neighbour(shape, 0, 0, 3), null);
  assert.equal(neighbour(shape, 3, 2, 0), null);
  assert.deepEqual(neighbour(shape, 0, 0, 0), { col: 1, row: 0 });
  assert.deepEqual(neighbour(shape, 1, 0, 2), { col: 0, row: 1 });
});

test("cellAt recovers the cell from points near its centre and its vertices", () => {
  for (let col = 0; col < shape.columns; col++) {
    for (let row = 0; row < shape.rows; row++) {
      const c = cellCenter(shape, col, row);
      assert.deepEqual(cellAt(shape, c), { col, row });
      for (let k = 0; k < 6; k++) {
        const v = cellVertex(shape, col, row, k);
        const inside = { x: c.x + (v.x - c.x) * 0.9, y: c.y + (v.y - c.y) * 0.9 };
        assert.deepEqual(cellAt(shape, inside), { col, row });
      }
    }
  }
  assert.equal(cellAt(shape, { x: -100, y: -100 }), null);
});

test("localBounds matches the brute-force vertex extent", () => {
  for (const s of [shape, { ...shape, columns: 1 }, { ...shape, rows: 1, columns: 7 }]) {
    const b = localBounds(s);
    const brute = worldBounds(s);
    near(b.minX, brute.minX);
    near(b.maxX, brute.maxX);
    near(b.minY, brute.minY);
    near(b.maxY, brute.maxY);
  }
});

test("rotate is counter-clockwise on screen and toLocal inverts toWorld", () => {
  const up = rotate({ x: 1, y: 0 }, 90, { x: 0, y: 0 });
  near(up.x, 0);
  near(up.y, -1);
  const rotated = { ...shape, orientationDeg: 37 };
  const p = { x: 12.5, y: -3 };
  const back = toLocal(rotated, toWorld(rotated, p));
  near(back.x, p.x);
  near(back.y, p.y);
});

test("30° orientation makes a pointy-top hex", () => {
  const s = { ...shape, columns: 1, rows: 1, orientationDeg: 30 };
  const b = worldBounds(s);
  near(b.maxX - b.minX, SQRT3 * 10);
  near(b.maxY - b.minY, 20);
});

test("distanceToSegment clamps to the segment ends", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };
  near(distanceToSegment({ x: 5, y: 3 }, a, b), 3);
  near(distanceToSegment({ x: 13, y: 4 }, a, b), 5);
  near(distanceToSegment({ x: 5, y: 5 }, a, a), Math.hypot(5, 5));
});
