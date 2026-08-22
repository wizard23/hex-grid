import test from "node:test";
import assert from "node:assert/strict";
import { cellVertex, type Point } from "./geometry";
import { createModel, toggleEdge, toggleSpoke, ALL_LINES } from "./model";
import { DEFAULT_SETTINGS, type GridShape } from "./settings";
import { documentBounds, fmt, outlineSegments, pathBands, spokeSegments, toPathData, toSvgDocument, type Segment } from "./svg";

const shape: GridShape = { columns: 5, rows: 4, side: 10, orientationDeg: 0 };

function key(p: Point): string {
  return `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
}

function edgeKey({ a, b }: Segment): string {
  const [x, y] = [key(a), key(b)].sort();
  return `${x}|${y}`;
}

test("outlineSegments emits every distinct hex edge exactly once", () => {
  const segments = outlineSegments(shape, createModel(shape.columns, shape.rows));
  const keys = segments.map(edgeKey);
  assert.equal(new Set(keys).size, keys.length, "no edge is drawn twice");

  const expected = new Set<string>();
  for (let col = 0; col < shape.columns; col++) {
    for (let row = 0; row < shape.rows; row++) {
      for (let k = 0; k < 6; k++) {
        expected.add(edgeKey({ a: cellVertex(shape, col, row, k), b: cellVertex(shape, col, row, k + 1) }));
      }
    }
  }
  assert.deepEqual(new Set(keys), expected, "every edge of every cell is covered");
});

test("outlineSegments drops a disabled edge whichever side it is toggled from", () => {
  const model = createModel(shape.columns, shape.rows);
  const all = outlineSegments(shape, model).length;
  const fromLeft = outlineSegments(shape, toggleEdge(model, 1, 1, 0));
  assert.equal(fromLeft.length, all - 1);
  const shared = edgeKey({ a: cellVertex(shape, 1, 1, 0), b: cellVertex(shape, 1, 1, 1) });
  assert.ok(!fromLeft.map(edgeKey).includes(shared));
  assert.equal(outlineSegments(shape, toggleEdge(model, 2, 1, 3)).length, all - 1);
  assert.equal(outlineSegments(shape, createModel(shape.columns, shape.rows, 0, 0)).length, 0);
});

test("spokeSegments follows the model bits", () => {
  let model = createModel(shape.columns, shape.rows);
  assert.equal(spokeSegments(shape, model).length, 0);
  model = toggleSpoke(model, 2, 1, 3);
  const [spoke] = spokeSegments(shape, model);
  assert.ok(spoke);
  assert.equal(edgeKey(spoke), edgeKey({ a: { x: 30, y: 10 * Math.sqrt(3) }, b: cellVertex(shape, 2, 1, 3) }));
  const full = createModel(shape.columns, shape.rows, ALL_LINES);
  assert.equal(spokeSegments(shape, full).length, 6 * shape.columns * shape.rows);
});

test("fmt keeps µm precision without trailing zeros or negative zero", () => {
  assert.equal(fmt(1.23456), "1.235");
  assert.equal(fmt(10), "10");
  assert.equal(fmt(-0.0000001), "0");
  assert.equal(toPathData([{ a: { x: 0, y: 0 }, b: { x: 1.5, y: 2 } }]), "M0 0L1.5 2");
});

test("toSvgDocument is sized in millimetres with the viewBox matching", () => {
  const settings = { ...DEFAULT_SETTINGS, columns: 2, rows: 2, side: 10, outlineWidth: 1, spokeWidth: 0.5 };
  const { svg, bounds } = toSvgDocument(settings, createModel(2, 2, 1));
  const expected = documentBounds(settings);
  assert.deepEqual(bounds, expected);
  const width = fmt(expected.maxX - expected.minX);
  const height = fmt(expected.maxY - expected.minY);
  assert.match(svg, new RegExp(`<svg [^>]*width="${width}mm" height="${height}mm"`));
  assert.match(svg, new RegExp(`viewBox="${fmt(expected.minX)} ${fmt(expected.minY)} ${width} ${height}"`));
  assert.match(svg, /fill="#000000"/);
  assert.match(svg, /stroke="#0000ff" stroke-width="1"/);
  assert.match(svg, /stroke="#d3d3d3" stroke-width="0.5"/);
  // padding = half the thickest stroke
  assert.equal(expected.minX, -10 - 0.5);
});

test("attribute values are escaped", () => {
  const { svg } = toSvgDocument({ ...DEFAULT_SETTINGS, columns: 1, rows: 1, outlineColor: '"><script' }, createModel(1, 1));
  assert.ok(!svg.includes("<script"));
});

function sortedSegments(path: string): string[] {
  return path.split("M").filter((s) => s !== "").sort();
}

test("pathBands covers every line and reuses untouched bands", () => {
  const full = createModel(shape.columns, shape.rows, ALL_LINES);
  const first = pathBands("spoke", shape, full, 3);
  assert.equal(first.paths.length, 2);
  assert.deepEqual(sortedSegments(first.paths.join("")), sortedSegments(toPathData(spokeSegments(shape, full))));

  const edited = toggleSpoke(full, 0, 3, 1);
  const second = pathBands("spoke", shape, edited, 3, first);
  assert.equal(second.paths[0], first.paths[0], "band with unchanged bytes is reused");
  assert.notEqual(second.paths[1], first.paths[1]);
  assert.deepEqual(sortedSegments(second.paths.join("")), sortedSegments(toPathData(spokeSegments(shape, edited))));

  const rotated = pathBands("spoke", { ...shape, orientationDeg: 10 }, edited, 3, second);
  assert.notEqual(rotated.paths[0], second.paths[0], "a shape change invalidates every band");

  const outline = pathBands("edge", shape, edited, 3);
  assert.deepEqual(sortedSegments(outline.paths.join("")), sortedSegments(toPathData(outlineSegments(shape, edited))));
  const edgeEdited = pathBands("edge", shape, toggleEdge(edited, 0, 0, 0), 3, outline);
  assert.notEqual(edgeEdited.paths[0], outline.paths[0]);
  assert.equal(edgeEdited.paths[1], outline.paths[1], "a spoke-only change does not touch outline bands of other rows");
  assert.notEqual(pathBands("edge", shape, edited, 3, second).paths[0], second.paths[0], "kinds never share bands");
});
