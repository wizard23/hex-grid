import test from "node:test";
import assert from "node:assert/strict";
import { createModel, toggleEdge, toggleSpoke } from "./model";
import type { CentreRef } from "./select";
import { captureStamp } from "./stamp";
import {
  cellOrbits,
  closure,
  generators,
  gridClosure,
  isFixedBy,
  isOrder3Rotation,
  isPureMirror,
  rotationFixedPoint,
  suggestDomain,
  tileGrid,
  elementOrbit,
  type GroupName,
  type GroupSpec,
} from "./symmetry";
import { IDENTITY, isometryKey, type Axial, type Isometry } from "./transform";

const cellCentre: CentreRef = { type: "cell", col: 2, row: 2, k: 0 };

function spec(name: GroupName, u: Axial, v: Axial = { q: 0, r: 0 }, centre: CentreRef = cellCentre): GroupSpec {
  return { name, u, v, centre };
}

/** distinct classes (linear part, translation mod ⟨u,v⟩) — the point-group order */
function cosetCount(s: GroupSpec): number {
  const group = closure(generators(s), { x: 4, y: 4 }, 14);
  const det = s.u.q * s.v.r - s.u.r * s.v.q;
  const latticeV = s.name === "p1" || s.name === "p2" || det !== 0 ? s.v : s.v;
  const v = ["p3", "p3m1", "p31m", "p6", "p6m"].includes(s.name) ? { q: -s.u.r, r: s.u.q + s.u.r } : latticeV;
  const d = s.u.q * v.r - s.u.r * v.q;
  const keys = new Set<string>();
  for (const g of group) {
    const alpha = (g.tq * v.r - g.tr * v.q) / d;
    const beta = (s.u.q * g.tr - s.u.r * g.tq) / d;
    const frac = (x: number) => Math.round((x - Math.floor(x + 1e-9)) * 1e6) / 1e6;
    keys.add(`${g.a},${g.b},${g.c},${g.d}|${frac(alpha)},${frac(beta)}`);
  }
  return keys.size;
}

test("every group has the right point-group order (cosets modulo the lattice)", () => {
  const u10: Axial = { q: 1, r: 0 };
  const vPerp: Axial = { q: -1, r: 2 }; // pixel-perpendicular to u10
  const vMirror: Axial = { q: 1, r: -1 }; // mirror image of u10 across the 0° axis
  const cases: [GroupSpec, number][] = [
    [spec("p1", { q: 2, r: 0 }, { q: 0, r: 2 }), 1],
    [spec("p2", { q: 2, r: 0 }, { q: 0, r: 2 }), 2],
    [spec("p3", u10), 3],
    [spec("p3m1", u10), 6],
    [spec("p31m", u10), 6],
    [spec("p6", u10), 6],
    [spec("p6m", u10), 12],
    [spec("pm", u10, vPerp), 2],
    [spec("pg", u10, vPerp), 2],
    [spec("cm", u10, vMirror), 2],
    [spec("pmm", u10, vPerp), 4],
    [spec("pmg", u10, vPerp), 4],
    [spec("pgg", u10, vPerp), 4],
    [spec("cmm", u10, vMirror), 4],
  ];
  for (const [s, expected] of cases) {
    assert.equal(cosetCount(s), expected, s.name);
  }
});

test("glide groups contain no pure mirror; mirror groups do", () => {
  const u10: Axial = { q: 1, r: 0 };
  const vPerp: Axial = { q: -1, r: 2 };
  const pgGroup = closure(generators(spec("pg", u10, vPerp)), { x: 4, y: 4 }, 12);
  assert.ok(pgGroup.every((g) => !isPureMirror(g)), "pg has glides only");
  assert.ok(pgGroup.some((g) => g.a * g.d - g.b * g.c === -1), "pg has orientation-reversing elements");
  const pmGroup = closure(generators(spec("pm", u10, vPerp)), { x: 4, y: 4 }, 12);
  assert.ok(pmGroup.some(isPureMirror), "pm has pure mirrors");
});

test("p3m1 has all 3-fold centres on mirrors; p31m does not (crystallographic distinguisher)", () => {
  function centresOnMirrors(name: GroupName): boolean {
    const group = closure(generators(spec(name, { q: 1, r: 0 })), { x: 4, y: 4 }, 12);
    const mirrors = group.filter((g) => g.a * g.d - g.b * g.c === -1);
    const rotations = group.filter(isOrder3Rotation);
    assert.ok(rotations.length > 0);
    return rotations.every((g) => {
      const p = rotationFixedPoint(g);
      return p !== null && mirrors.some((m) => isFixedBy(m, p));
    });
  }
  assert.equal(centresOnMirrors("p3m1"), true);
  assert.equal(centresOnMirrors("p31m"), false);
});

test("invalid specs are rejected with readable messages", () => {
  assert.throws(() => generators(spec("p6", { q: 1, r: 0 }, { q: 0, r: 0 }, { type: "vertex", col: 2, row: 2, k: 1 })), /does not preserve/);
  assert.throws(() => generators(spec("pm", { q: 1, r: 0 }, { q: 1, r: 1 })), /perpendicular/);
  assert.throws(() => generators(spec("p3m1", { q: 2, r: 1 })), /grid axis|not preserved/);
  assert.throws(() => generators(spec("cm", { q: 1, r: 0 }, { q: -1, r: 2 })), /mirror image|grid axis/);
  assert.throws(() => generators(spec("p1", { q: 0, r: 0 }, { q: 1, r: 0 })), /non-zero/);
  assert.throws(() => generators(spec("p1", { q: 1, r: 0 }, { q: 2, r: 0 })), /independent/);
});

test("cell orbits match Burnside: p6 with the unit lattice has 1, with the doubled lattice 2", () => {
  const grid = { columns: 5, rows: 5 };
  assert.equal(cellOrbits(spec("p6", { q: 1, r: 0 }), grid).orbitCount, 1);
  assert.equal(cellOrbits(spec("p6", { q: 2, r: 0 }), grid).orbitCount, 2);
  assert.equal(cellOrbits(spec("p1", { q: 2, r: 0 }, { q: 0, r: 2 }), { columns: 6, rows: 6 }).orbitCount, 4);
});

test("suggestDomain returns one cell per orbit, near the start", () => {
  const grid = { columns: 6, rows: 6 };
  const s = spec("p1", { q: 2, r: 0 }, { q: 0, r: 2 });
  const domain = suggestDomain(s, grid, { col: 3, row: 3 });
  assert.equal(domain.length, 4);
  const { orbitOf } = cellOrbits(s, grid);
  const orbits = domain.map((c) => orbitOf[c.row * grid.columns + c.col]);
  assert.equal(new Set(orbits).size, 4);
});

test("p6 tiling of a symmetric single-cell stamp covers the grid without conflicts", () => {
  const source = createModel(5, 5); // all edges on, nothing else
  const stamp = captureStamp(source, [{ col: 2, row: 2 }], { col: 2, row: 2 });
  const empty = createModel(5, 5, 0, 0, 0);
  const result = tileGrid(empty, stamp, spec("p6", { q: 1, r: 0 }), { col: 2, row: 2 });
  assert.equal(result.gaps, 0);
  assert.equal(result.conflicts, 0);
  // every edge of the grid is drawn
  assert.ok(result.copies >= 25);
  const asymmetric = captureStamp(toggleSpoke(source, 2, 2, 0), [{ col: 2, row: 2 }], { col: 2, row: 2 });
  const conflicted = tileGrid(empty, asymmetric, spec("p6", { q: 1, r: 0 }), { col: 2, row: 2 });
  assert.ok(conflicted.conflicts > 0, "a 6-fold-asymmetric cell cannot tile under p6");
});

test("p1 tiling: a 2×2 block tiles a 6×6 grid; a boundary mismatch is a conflict", () => {
  const source = createModel(6, 6);
  const block = [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
    { col: 0, row: 1 },
    { col: 1, row: 1 },
  ];
  const stamp = captureStamp(source, block, { col: 0, row: 0 });
  const s = spec("p1", { q: 2, r: 0 }, { q: 0, r: 2 });
  const result = tileGrid(createModel(6, 6, 0, 0, 0), stamp, s, { col: 0, row: 0 });
  assert.equal(result.gaps, 0);
  assert.equal(result.conflicts, 0);
  // disable an edge on the stamp's boundary: neighbouring copies disagree
  const mismatched = captureStamp(toggleEdge(source, 1, 0, 0), block, { col: 0, row: 0 });
  const conflicted = tileGrid(createModel(6, 6, 0, 0, 0), mismatched, s, { col: 0, row: 0 });
  assert.ok(conflicted.conflicts > 0);
});

test("gaps are reported when the stamp misses orbits", () => {
  const source = createModel(6, 6);
  const stamp = captureStamp(source, [{ col: 0, row: 0 }], { col: 0, row: 0 }); // 1 cell, lattice needs 4
  const result = tileGrid(createModel(6, 6, 0, 0, 0), stamp, spec("p1", { q: 2, r: 0 }, { q: 0, r: 2 }), { col: 0, row: 0 });
  assert.ok(result.gaps > 0);
});

test("elementOrbit expands an edit to the whole consistency class", () => {
  const gens = generators(spec("p6", { q: 1, r: 0 }));
  const inCell = (el: { col: number; row: number }) => el.col === 2 && el.row === 2;
  const orbit = elementOrbit(gens, { kind: "spoke", col: 2, row: 2, k: 0 }, inCell, { x: 4, y: 4 }, 10);
  assert.equal(orbit.length, 6, "all six spokes of the centre cell are one class");
  assert.deepEqual(new Set(orbit.map((el) => el.k)), new Set([0, 1, 2, 3, 4, 5]));
});

test("gridClosure identity ordering keeps the anchor copy first", () => {
  const group = gridClosure(spec("p2", { q: 2, r: 0 }, { q: 0, r: 2 }), { columns: 4, rows: 4 });
  const first = group[0] as Isometry;
  assert.equal(isometryKey(first), isometryKey(IDENTITY));
});
