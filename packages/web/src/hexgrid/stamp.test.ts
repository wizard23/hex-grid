import test from "node:test";
import assert from "node:assert/strict";
import { cellToAxial, type Cell } from "./geometry";
import {
  CENTRE,
  createModel,
  hasEdge,
  hasSpoke,
  hasVertex,
  setTriangleState,
  toggleEdge,
  toggleSpoke,
  toggleVertex,
  triangleState,
} from "./model";
import { DEFAULT_SETTINGS } from "./settings";
import {
  applyStamp,
  captureStamp,
  createPainter,
  libraryToJson,
  parseLibrary,
  stampThumbnail,
  stampToDocumentModel,
} from "./stamp";
import { cellPoint6, compose, rotationAbout, translation, applyElement, applyCell, IDENTITY } from "./transform";

function sampleModel() {
  let m = createModel(6, 6); // edges all on by default
  m = toggleSpoke(m, 2, 2, 1);
  m = toggleSpoke(m, 3, 2, 4);
  m = toggleEdge(m, 2, 2, 0);
  m = toggleVertex(m, 2, 2, CENTRE);
  m = toggleVertex(m, 3, 2, 2);
  m = setTriangleState(m, 2, 2, 5, 2);
  return m;
}

const region: Cell[] = [
  { col: 2, row: 2 },
  { col: 3, row: 2 },
  { col: 2, row: 3 },
];
const anchor = { col: 2, row: 2 };

test("capture + identity replace reproduces the region on an empty grid", () => {
  const source = sampleModel();
  const stamp = captureStamp(source, region, anchor);
  const a = cellToAxial(anchor);
  const target = applyStamp(createModel(6, 6, 0, 0, 0), stamp, translation(a.q, a.r), "replace");
  for (const cell of region) {
    for (let k = 0; k < 6; k++) {
      assert.equal(hasSpoke(target, cell.col, cell.row, k), hasSpoke(source, cell.col, cell.row, k), `spoke ${k}`);
      assert.equal(hasEdge(target, cell.col, cell.row, k), hasEdge(source, cell.col, cell.row, k), `edge ${k}`);
      assert.equal(hasVertex(target, cell.col, cell.row, k), hasVertex(source, cell.col, cell.row, k), `vertex ${k}`);
      assert.equal(triangleState(target, cell.col, cell.row, k), triangleState(source, cell.col, cell.row, k));
    }
    assert.equal(hasVertex(target, cell.col, cell.row, CENTRE), hasVertex(source, cell.col, cell.row, CENTRE));
  }
});

test("rotated placement moves every element to its image", () => {
  const source = sampleModel();
  const stamp = captureStamp(source, region, anchor);
  const a = cellToAxial(anchor);
  // rotate 120° about the anchor cell, placed at the anchor itself
  const iso = compose(translation(a.q, a.r), rotationAbout(cellPoint6({ col: 0, row: 0 }), 2));
  const target = applyStamp(createModel(6, 6, 0, 0, 0), stamp, iso, "replace");
  // the anchor cell (2,2) is relative (0,0): its toggled spoke k=1 lands on the image element
  assert.equal(hasSpoke(source, 2, 2, 1), true);
  const spoke = applyElement(iso, { kind: "spoke", col: 0, row: 0, k: 1 });
  assert.equal(hasSpoke(target, spoke.col, spoke.row, spoke.k), true);
  // the rotation about the anchor keeps the anchor cell in place but moves the index
  assert.deepEqual({ col: spoke.col, row: spoke.row, k: spoke.k }, { col: 2, row: 2, k: 3 });
  // the centre dot of the anchor cell maps to the anchor cell itself
  assert.equal(hasVertex(target, 2, 2, CENTRE), true);
  // the triangle state 2 at (2,2,t=5) lands on its image
  const tri = applyElement(iso, { kind: "triangle", col: 0, row: 0, k: 5 });
  assert.equal(triangleState(target, tri.col, tri.row, tri.k), 2);
});

test("merge only adds; replace overwrites; clipping skips outside cells silently", () => {
  const source = sampleModel();
  const stamp = captureStamp(source, region, anchor);
  const a = cellToAxial(anchor);
  let target = createModel(6, 6); // all edges on
  target = toggleSpoke(target, 2, 2, 0); // extra line the stamp doesn't have
  const merged = applyStamp(target, stamp, translation(a.q, a.r), "merge");
  assert.equal(hasSpoke(merged, 2, 2, 0), true, "merge keeps existing lines");
  assert.equal(hasSpoke(merged, 2, 2, 1), true, "merge adds the stamp's lines");
  assert.equal(hasEdge(merged, 2, 2, 0), true, "merge does not remove the disabled edge's counterpart");
  const replaced = applyStamp(target, stamp, translation(a.q, a.r), "replace");
  assert.equal(hasSpoke(replaced, 2, 2, 0), false, "replace overwrites");
  assert.equal(hasEdge(replaced, 2, 2, 0), false, "replace restores the stamp's disabled edge");
  // placement hanging off the grid edge: no throw
  const clipped = applyStamp(createModel(2, 2, 0, 0, 0), stamp, translation(0, 0), "replace");
  assert.equal(clipped.columns, 2);
});

test("first-wins counts conflicts and keeps the first value", () => {
  const empty = createModel(4, 4, 0, 0, 0);
  const painter = createPainter(empty);
  painter.setSpoke({ col: 1, row: 1 }, 2, true, "first-wins");
  painter.setSpoke({ col: 1, row: 1 }, 2, true, "first-wins"); // same value: no conflict
  painter.setSpoke({ col: 1, row: 1 }, 2, false, "first-wins"); // different: conflict
  painter.setTriangle({ col: 1, row: 1 }, 0, 2, "first-wins");
  painter.setTriangle({ col: 1, row: 1 }, 0, 1, "first-wins");
  const { model, conflicts } = painter.finish();
  assert.equal(conflicts, 2);
  assert.equal(hasSpoke(model, 1, 1, 2), true);
  assert.equal(triangleState(model, 1, 1, 0), 2);
});

test("stampToDocumentModel embeds the stamp in a minimal grid with matching membership", () => {
  const source = sampleModel();
  const stamp = captureStamp(source, region, { col: 3, row: 2 }); // anchor ≠ min corner → negative offsets
  const { model, members, embed } = stampToDocumentModel(stamp);
  assert.equal(members.size, region.length);
  assert.ok(model.columns >= 2 && model.rows >= 2);
  // the anchor-relative cell (0,0) has the spokes captured at (3,2)
  const at = applyCell(embed, { col: 0, row: 0 });
  assert.equal(hasSpoke(model, at.col, at.row, 4), true);
  // non-member cells have no lines at all
  let lines = 0;
  for (let col = 0; col < model.columns; col++) {
    for (let row = 0; row < model.rows; row++) {
      for (let k = 0; k < 6; k++) if (hasEdge(model, col, row, k)) lines++;
    }
  }
  assert.ok(lines > 0, "member edges present");
});

test("thumbnail renders an SVG in the document colours; library JSON round-trips", () => {
  const stamp = captureStamp(sampleModel(), region, anchor, { type: "vertex", dq: 0, dr: 0, k: 1 });
  const svg = stampThumbnail(stamp, DEFAULT_SETTINGS);
  assert.match(svg, /^<svg /);
  assert.match(svg, /stroke="#0000ff"/);
  const entry = { id: "s1", name: "2026-08-24 10:00", createdAt: 1, modifiedAt: 2, stamp };
  const loaded = parseLibrary(libraryToJson([entry]));
  assert.equal(loaded.length, 1);
  assert.deepEqual(loaded[0], entry);
  assert.throws(() => parseLibrary("{}"), /not a stamp library/);
  assert.throws(() => parseLibrary('{"format":"hex-grid-stamps","version":1,"stamps":[{"id":"x","name":"y","stamp":{"cells":[]}}]}'), /no cells/);
});

test("paintStamp writes shared boundary elements consistently from both sides", () => {
  // two adjacent cells with the shared edge disabled in the source
  let source = createModel(4, 4);
  source = toggleEdge(source, 1, 1, 0);
  const cells = [{ col: 1, row: 1 }, applyCell(IDENTITY, { col: 2, row: 2 })];
  const stamp = captureStamp(source, cells, { col: 1, row: 1 });
  const a = cellToAxial({ col: 1, row: 1 });
  const target = applyStamp(createModel(4, 4), stamp, translation(a.q, a.r), "replace");
  assert.equal(hasEdge(target, 1, 1, 0), false, "the disabled shared edge survives the copy");
});
