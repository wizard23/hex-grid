import test from "node:test";
import assert from "node:assert/strict";
import { cellCenter, cellVertex, type Point } from "./geometry";
import {
  ALL_LINES,
  ALL_VERTICES,
  CENTRE,
  createModel,
  setTriangleState,
  toggleEdge,
  toggleSpoke,
  toggleVertex,
} from "./model";
import { DEFAULT_SETTINGS, type GridShape } from "./settings";
import {
  documentBounds,
  fmt,
  outlineSegments,
  pathBands,
  spokeSegments,
  toDotPathData,
  toPathData,
  toPolygonPathData,
  toSvgDocument,
  triangleShapes,
  vertexPoints,
  FILL_SEAM_STROKE,
  type Segment,
} from "./svg";

const shape: GridShape = { columns: 5, rows: 4, side: 10, orientationDeg: 0 };
const settings = { ...DEFAULT_SETTINGS, ...shape };

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

test("vertexPoints emits every distinct corner and centre exactly once", () => {
  const all = vertexPoints(shape, createModel(shape.columns, shape.rows, 0, ALL_LINES, ALL_VERTICES));
  const keys = all.map(key);
  assert.equal(new Set(keys).size, keys.length, "no point is drawn twice");
  const expected = new Set<string>();
  for (let col = 0; col < shape.columns; col++) {
    for (let row = 0; row < shape.rows; row++) {
      expected.add(key(cellCenter(shape, col, row)));
      for (let k = 0; k < 6; k++) expected.add(key(cellVertex(shape, col, row, k)));
    }
  }
  assert.deepEqual(new Set(keys), expected);

  const none = createModel(shape.columns, shape.rows);
  assert.equal(vertexPoints(shape, none).length, 0);
  const one = toggleVertex(none, 2, 1, CENTRE);
  assert.deepEqual(vertexPoints(shape, one).map(key), [key(cellCenter(shape, 2, 1))]);
  // a shared corner toggled from a non-owner cell is emitted by its owner
  const corner = toggleVertex(none, 2, 1, 2);
  assert.deepEqual(vertexPoints(shape, corner).map(key), [key(cellVertex(shape, 2, 1, 2))]);
});

test("triangleShapes lists the triangles of one state; toPolygonPathData closes each", () => {
  const none = createModel(shape.columns, shape.rows);
  assert.equal(triangleShapes(shape, none, 1).length, 0);
  assert.equal(triangleShapes(shape, none, 0).length, 6 * shape.columns * shape.rows);
  const one = setTriangleState(setTriangleState(none, 2, 1, 3, 1), 0, 0, 0, 2);
  const [tri] = triangleShapes(shape, one, 1);
  assert.ok(tri);
  assert.deepEqual(tri.map(key), [cellCenter(shape, 2, 1), cellVertex(shape, 2, 1, 3), cellVertex(shape, 2, 1, 4)].map(key));
  assert.equal(triangleShapes(shape, one, 2).length, 1);
  assert.equal(triangleShapes(shape, one, 1, 0, 1).length, 0, "row range respected");
  assert.equal(toPolygonPathData([[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]]), "M0 0L1 0L0 1Z");
});

test("toDotPathData draws one filled circle per point", () => {
  assert.equal(toDotPathData([{ x: 1, y: 2 }], 0.5), "M1.25 2A0.25 0.25 0 1 0 0.75 2A0.25 0.25 0 1 0 1.25 2Z");
  assert.equal(toDotPathData([], 1), "");
});

test("fmt keeps µm precision without trailing zeros or negative zero", () => {
  assert.equal(fmt(1.23456), "1.235");
  assert.equal(fmt(10), "10");
  assert.equal(fmt(-0.0000001), "0");
  assert.equal(toPathData([{ a: { x: 0, y: 0 }, b: { x: 1.5, y: 2 } }]), "M0 0L1.5 2");
});

test("toSvgDocument is sized in millimetres with the viewBox matching", () => {
  const settings = { ...DEFAULT_SETTINGS, columns: 2, rows: 2, side: 10, outlineWidth: 1, spokeWidth: 0.5 };
  const { svg, bounds } = toSvgDocument(settings, createModel(2, 2, 1, ALL_LINES, ALL_VERTICES));
  const expected = documentBounds(settings);
  assert.deepEqual(bounds, expected);
  const width = fmt(expected.maxX - expected.minX);
  const height = fmt(expected.maxY - expected.minY);
  assert.match(svg, new RegExp(`<svg [^>]*width="${width}mm" height="${height}mm"`));
  assert.match(svg, new RegExp(`viewBox="${fmt(expected.minX)} ${fmt(expected.minY)} ${width} ${height}"`));
  assert.match(svg, /fill="#000000"/);
  assert.match(svg, /stroke="#0000ff" stroke-width="1"/);
  assert.match(svg, /stroke="#d3d3d3" stroke-width="0.5"/);
  assert.match(svg, /<path d="M[^"]*A0\.15 0\.15[^"]*" fill="#ffffff"\/>/, "dots are a filled path in the vertex colour");
  assert.ok(!svg.includes('stroke-width="0.1"'), "no fill paths when nothing is filled");
  const filled = toSvgDocument(settings, setTriangleState(createModel(2, 2), 1, 0, 2, 2)).svg;
  const fillPath = new RegExp(`<path d="M[^"]*Z" fill="#cccccc" stroke="#cccccc" stroke-width="${FILL_SEAM_STROKE}"`);
  assert.match(filled, fillPath, "state 2 uses the second grey, with a seam stroke");
  assert.ok(filled.indexOf('fill="#cccccc"') < filled.indexOf('stroke="#d3d3d3"'), "fills are drawn below the lines");
  // padding = half the thickest stroke
  assert.equal(expected.minX, -10 - 0.5);
  const bigDots = documentBounds({ ...settings, vertexDiameter: 4 });
  assert.equal(bigDots.minX, -10 - 2, "large dots widen the padding");
});

test("attribute values are escaped", () => {
  const { svg } = toSvgDocument({ ...DEFAULT_SETTINGS, columns: 1, rows: 1, outlineColor: '"><script' }, createModel(1, 1));
  assert.ok(!svg.includes("<script"));
});

function sortedSegments(path: string): string[] {
  return path.split("M").filter((s) => s !== "").sort();
}

test("pathBands covers every line and reuses untouched bands", () => {
  const full = createModel(shape.columns, shape.rows, ALL_LINES, ALL_LINES, ALL_VERTICES);
  const first = pathBands({ kind: "spoke" }, settings, full, 3);
  assert.equal(first.paths.length, 2);
  assert.deepEqual(sortedSegments(first.paths.join("")), sortedSegments(toPathData(spokeSegments(shape, full))));

  const edited = toggleSpoke(full, 0, 3, 1);
  const second = pathBands({ kind: "spoke" }, settings, edited, 3, first);
  assert.equal(second.paths[0], first.paths[0], "band with unchanged bytes is reused");
  assert.notEqual(second.paths[1], first.paths[1]);
  assert.deepEqual(sortedSegments(second.paths.join("")), sortedSegments(toPathData(spokeSegments(shape, edited))));

  const rotated = pathBands({ kind: "spoke" }, { ...settings, orientationDeg: 10 }, edited, 3, second);
  assert.notEqual(rotated.paths[0], second.paths[0], "a shape change invalidates every band");

  const outline = pathBands({ kind: "edge" }, settings, edited, 3);
  assert.deepEqual(sortedSegments(outline.paths.join("")), sortedSegments(toPathData(outlineSegments(shape, edited))));
  const edgeEdited = pathBands({ kind: "edge" }, settings, toggleEdge(edited, 0, 0, 0), 3, outline);
  assert.notEqual(edgeEdited.paths[0], outline.paths[0]);
  assert.equal(edgeEdited.paths[1], outline.paths[1], "a spoke-only change does not touch outline bands of other rows");
  assert.notEqual(pathBands({ kind: "edge" }, settings, edited, 3, second).paths[0], second.paths[0], "kinds never share bands");

  const dots = pathBands({ kind: "vertex" }, settings, edited, 3);
  assert.equal(dots.paths.join("").split("Z").length - 1, vertexPoints(shape, edited).length, "one circle per dot");
  const resized = pathBands({ kind: "vertex" }, { ...settings, vertexDiameter: 1 }, edited, 3, dots);
  assert.notEqual(resized.paths[0], dots.paths[0], "a diameter change invalidates vertex bands");
  const sameDots = pathBands({ kind: "vertex" }, settings, toggleSpoke(edited, 0, 0, 0), 3, dots);
  assert.deepEqual(sameDots.paths, dots.paths, "line changes do not rebuild vertex bands");

  const painted = setTriangleState(setTriangleState(edited, 0, 0, 1, 1), 0, 3, 2, 2);
  const state1 = pathBands({ kind: "triangle", state: 1 }, settings, painted, 3);
  const state2 = pathBands({ kind: "triangle", state: 2 }, settings, painted, 3);
  assert.equal(state1.paths.join(""), toPolygonPathData(triangleShapes(shape, painted, 1)));
  assert.equal(state2.paths.join(""), toPolygonPathData(triangleShapes(shape, painted, 2)));
  assert.equal(state1.paths[1], "", "band without state-1 triangles is empty");
  assert.notEqual(pathBands({ kind: "triangle", state: 2 }, settings, painted, 3, state1).paths[0], state1.paths[0], "states never share bands");
  const repainted = pathBands({ kind: "triangle", state: 1 }, settings, setTriangleState(painted, 0, 3, 0, 1), 3, state1);
  assert.equal(repainted.paths[0], state1.paths[0], "untouched band reused");
  assert.notEqual(repainted.paths[1], state1.paths[1]);
});
