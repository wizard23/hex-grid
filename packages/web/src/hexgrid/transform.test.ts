import test from "node:test";
import assert from "node:assert/strict";
import { canonicalEdge, canonicalVertex, UNBOUNDED } from "./geometry";
import { CENTRE } from "./model";
import {
  applyAxial,
  applyCell,
  applyElement,
  cellPoint6,
  compose,
  cornerPoint6,
  edgeMidpoint6,
  IDENTITY,
  invert,
  isometryKey,
  reflectionAbout,
  rotationAbout,
  translation,
  type ElementRef,
  type Isometry,
} from "./transform";

const origin6 = cellPoint6({ col: 0, row: 0 });

function isIdentity(iso: Isometry): boolean {
  return isometryKey(iso) === isometryKey(IDENTITY);
}

test("rotation about a cell centre has order 6 and cycles the neighbours", () => {
  const r = rotationAbout(origin6, 1);
  let acc = IDENTITY;
  for (let i = 0; i < 6; i++) acc = compose(r, acc);
  assert.ok(isIdentity(acc));
  // neighbour ring: axial (1,0) → (0,1) → (−1,1) → …
  assert.deepEqual(applyAxial(r, { q: 1, r: 0 }), { q: 0, r: 1 });
  assert.deepEqual(applyAxial(r, { q: 0, r: 1 }), { q: -1, r: 1 });
});

test("compose/invert are exact inverses", () => {
  const isos = [
    rotationAbout(origin6, 2),
    reflectionAbout(origin6, 1),
    compose(translation(3, -2), rotationAbout(cellPoint6({ col: 2, row: 1 }), 3)),
    compose(reflectionAbout(cornerPoint6({ col: 1, row: 1 }, 2), 2), translation(-1, 4)),
  ];
  for (const iso of isos) {
    assert.ok(isIdentity(compose(iso, invert(iso))));
    assert.ok(isIdentity(compose(invert(iso), iso)));
  }
});

test("120° about a corner cycles the three cells sharing it; 60° about a corner is rejected", () => {
  const v6 = cornerPoint6({ col: 0, row: 0 }, 1); // shared by (0,0), (1,0), (0,1) — corner 1 is down-right
  const r = rotationAbout(v6, 2);
  const cells = [
    { col: 0, row: 0 },
    applyCell(r, { col: 0, row: 0 }),
    applyCell(r, applyCell(r, { col: 0, row: 0 })),
  ];
  assert.equal(new Set(cells.map((c) => `${c.col},${c.row}`)).size, 3, "three distinct cells");
  assert.deepEqual(applyCell(r, cells[2]!), cells[0]);
  assert.throws(() => rotationAbout(v6, 1), /does not preserve/);
  // an edge midpoint only admits mirrors along or across its edge
  assert.throws(() => reflectionAbout(edgeMidpoint6({ col: 0, row: 1 }, 2), 3), /does not preserve/);
  assert.ok(reflectionAbout(edgeMidpoint6({ col: 0, row: 1 }, 2), 5), "axis along the edge is fine");
});

test("180° about an edge midpoint swaps the two cells; mirrors are involutions", () => {
  const m6 = edgeMidpoint6({ col: 0, row: 0 }, 0);
  const r = rotationAbout(m6, 3);
  const other = applyCell(r, { col: 0, row: 0 });
  assert.notDeepEqual(other, { col: 0, row: 0 });
  assert.deepEqual(applyCell(r, other), { col: 0, row: 0 });
  for (let axis = 0; axis < 6; axis++) {
    const m = reflectionAbout(origin6, axis);
    assert.ok(isIdentity(compose(m, m)), `axis ${axis} involution`);
    assert.equal(m.a * m.d - m.b * m.c, -1, "orientation-reversing");
  }
});

test("applyElement preserves kinds, respects canonical sharing and is compatible with composition", () => {
  const isos = [
    rotationAbout(origin6, 1),
    rotationAbout(cornerPoint6({ col: 1, row: 0 }, 0), 4),
    reflectionAbout(origin6, 0),
    reflectionAbout(edgeMidpoint6({ col: 0, row: 1 }, 2), 2), // perpendicular to edge 2
    compose(translation(2, -1), reflectionAbout(origin6, 5)),
  ];
  const elements: ElementRef[] = [];
  for (const kind of ["spoke", "edge", "vertex", "triangle"] as const) {
    for (let k = 0; k < 6; k++) elements.push({ kind, col: 1, row: 1, k });
  }
  elements.push({ kind: "vertex", col: 1, row: 1, k: CENTRE });
  for (const iso of isos) {
    const seen = new Set<string>();
    for (const el of elements) {
      const out = applyElement(iso, el);
      assert.equal(out.kind, el.kind);
      seen.add(`${out.kind}:${out.col},${out.row},${out.k}`);
      // canonical: mapping then canonicalising equals mapping the canonical ref
      if (el.kind === "edge") {
        const can = canonicalEdge(UNBOUNDED, el.col, el.row, el.k);
        assert.deepEqual(applyElement(iso, { kind: "edge", ...can }), out);
      }
      if (el.kind === "vertex" && el.k !== CENTRE) {
        const can = canonicalVertex(UNBOUNDED, el.col, el.row, el.k);
        assert.deepEqual(applyElement(iso, { kind: "vertex", ...can }), out);
      }
      // inverse maps back
      const back = applyElement(invert(iso), out);
      const canonical =
        el.kind === "edge"
          ? { kind: el.kind, ...canonicalEdge(UNBOUNDED, el.col, el.row, el.k) }
          : el.kind === "vertex" && el.k !== CENTRE
            ? { kind: el.kind, ...canonicalVertex(UNBOUNDED, el.col, el.row, el.k) }
            : el;
      assert.deepEqual(back, canonical);
    }
    // all 25 inputs are distinct lattice elements, so their images must be too
    assert.equal(seen.size, elements.length, "injective");
  }
});

test("rotating a cell's own elements about its centre shifts indices by one", () => {
  const c6 = cellPoint6({ col: 2, row: 1 });
  const r = rotationAbout(c6, 1);
  assert.deepEqual(applyElement(r, { kind: "spoke", col: 2, row: 1, k: 0 }), { kind: "spoke", col: 2, row: 1, k: 1 });
  assert.deepEqual(applyElement(r, { kind: "triangle", col: 2, row: 1, k: 3 }), { kind: "triangle", col: 2, row: 1, k: 4 });
  assert.deepEqual(applyElement(r, { kind: "vertex", col: 2, row: 1, k: CENTRE }), { kind: "vertex", col: 2, row: 1, k: CENTRE });
});
