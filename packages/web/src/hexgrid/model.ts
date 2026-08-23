import { canonicalEdge, canonicalVertex } from "./geometry";

/**
 * Per-cell state:
 * - `spokes`: bit k set ⇔ the line from the cell centre to corner k is drawn;
 * - `edges`: bit k set ⇔ the hex edge between corner k and k+1 is drawn;
 * - `vertices`: bits 0–5 ⇔ the dot at corner k, bit 6 ⇔ the dot at the centre;
 * - `triangles`: six bytes per cell, the fill state (0 = none) of the triangle
 *   between the centre, corner t and corner t+1.
 * Shared edges and corners are stored once, on their canonical owner (see
 * `canonicalEdge` / `canonicalVertex`); triangles belong to one cell. Models
 * are treated as immutable values; every update returns a fresh copy.
 */
export const LINE_COUNT = 6;
export const ALL_LINES = (1 << LINE_COUNT) - 1;
/** vertex index of the cell centre (corners are 0–5) */
export const CENTRE = 6;
export const ALL_VERTICES = (1 << (CENTRE + 1)) - 1;
export const TRIANGLES_PER_CELL = 6;

export type GridModel = {
  readonly columns: number;
  readonly rows: number;
  readonly spokes: Uint8Array;
  readonly edges: Uint8Array;
  readonly vertices: Uint8Array;
  readonly triangles: Uint8Array;
};

export type LineKind = "spoke" | "edge";
export type ElementKind = LineKind | "vertex" | "triangle";

export function createModel(columns: number, rows: number, spokes = 0, edges = ALL_LINES, vertices = 0): GridModel {
  const cells = columns * rows;
  return {
    columns,
    rows,
    spokes: new Uint8Array(cells).fill(spokes & ALL_LINES),
    edges: new Uint8Array(cells).fill(edges & ALL_LINES),
    vertices: new Uint8Array(cells).fill(vertices & ALL_VERTICES),
    triangles: new Uint8Array(cells * TRIANGLES_PER_CELL),
  };
}

export function bytesOf(model: GridModel, kind: ElementKind): Uint8Array {
  switch (kind) {
    case "spoke":
      return model.spokes;
    case "edge":
      return model.edges;
    case "vertex":
      return model.vertices;
    case "triangle":
      return model.triangles;
  }
}

export function bytesPerCell(kind: ElementKind): number {
  return kind === "triangle" ? TRIANGLES_PER_CELL : 1;
}

export function cellIndex(model: GridModel, col: number, row: number): number {
  return row * model.columns + col;
}

export function spokesOf(model: GridModel, col: number, row: number): number {
  return model.spokes[cellIndex(model, col, row)] ?? 0;
}

export function hasSpoke(model: GridModel, col: number, row: number, k: number): boolean {
  return (spokesOf(model, col, row) & (1 << k)) !== 0;
}

/** whether edge k of the cell is drawn — resolved through the edge's owner */
export function hasEdge(model: GridModel, col: number, row: number, k: number): boolean {
  const e = canonicalEdge(model, col, row, k);
  return ((model.edges[cellIndex(model, e.col, e.row)] ?? 0) & (1 << e.k)) !== 0;
}

/** whether the dot at corner k (or the centre, k = CENTRE) is drawn — resolved through the owner */
export function hasVertex(model: GridModel, col: number, row: number, k: number): boolean {
  const v = k === CENTRE ? { col, row, k } : canonicalVertex(model, col, row, k);
  return ((model.vertices[cellIndex(model, v.col, v.row)] ?? 0) & (1 << v.k)) !== 0;
}

export function hasElement(model: GridModel, kind: LineKind | "vertex", col: number, row: number, k: number): boolean {
  if (kind === "spoke") return hasSpoke(model, col, row, k);
  if (kind === "edge") return hasEdge(model, col, row, k);
  return hasVertex(model, col, row, k);
}

export function triangleIndex(model: GridModel, col: number, row: number, t: number): number {
  return cellIndex(model, col, row) * TRIANGLES_PER_CELL + t;
}

export function triangleState(model: GridModel, col: number, row: number, t: number): number {
  return model.triangles[triangleIndex(model, col, row, t)] ?? 0;
}

function withBitFlipped(bytes: Uint8Array, index: number, bit: number): Uint8Array {
  const next = new Uint8Array(bytes);
  next[index] = (next[index] ?? 0) ^ (1 << bit);
  return next;
}

export function toggleSpoke(model: GridModel, col: number, row: number, k: number): GridModel {
  return { ...model, spokes: withBitFlipped(model.spokes, cellIndex(model, col, row), k) };
}

export function toggleEdge(model: GridModel, col: number, row: number, k: number): GridModel {
  const e = canonicalEdge(model, col, row, k);
  return { ...model, edges: withBitFlipped(model.edges, cellIndex(model, e.col, e.row), e.k) };
}

export function toggleVertex(model: GridModel, col: number, row: number, k: number): GridModel {
  const v = k === CENTRE ? { col, row, k } : canonicalVertex(model, col, row, k);
  return { ...model, vertices: withBitFlipped(model.vertices, cellIndex(model, v.col, v.row), v.k) };
}

export function toggleElement(model: GridModel, kind: LineKind | "vertex", col: number, row: number, k: number): GridModel {
  if (kind === "spoke") return toggleSpoke(model, col, row, k);
  if (kind === "edge") return toggleEdge(model, col, row, k);
  return toggleVertex(model, col, row, k);
}

export function setTriangleState(model: GridModel, col: number, row: number, t: number, state: number): GridModel {
  const triangles = new Uint8Array(model.triangles);
  triangles[triangleIndex(model, col, row, t)] = state;
  return { ...model, triangles };
}

/** advance the triangle to the next of `stateCount` states, wrapping to 0 */
export function cycleTriangle(model: GridModel, col: number, row: number, t: number, stateCount: number): GridModel {
  return setTriangleState(model, col, row, t, (triangleState(model, col, row, t) + 1) % stateCount);
}

/** cap every triangle to the highest state that exists for `stateCount` */
export function clampTriangles(model: GridModel, stateCount: number): GridModel {
  const max = stateCount - 1;
  if (!model.triangles.some((s) => s > max)) return model;
  return { ...model, triangles: model.triangles.map((s) => Math.min(s, max)) };
}

/** preset every cell's lines; vertices and fills are left as they are */
export function fillLines(model: GridModel, spokes: number, edges: number): GridModel {
  const cells = model.columns * model.rows;
  return {
    ...model,
    spokes: new Uint8Array(cells).fill(spokes & ALL_LINES),
    edges: new Uint8Array(cells).fill(edges & ALL_LINES),
  };
}

export function fillVertices(model: GridModel, vertices: number): GridModel {
  return { ...model, vertices: new Uint8Array(model.columns * model.rows).fill(vertices & ALL_VERTICES) };
}

export function clearTriangles(model: GridModel): GridModel {
  return { ...model, triangles: new Uint8Array(model.triangles.length) };
}

/** change dimensions, keeping the state of every cell that still exists */
export function resizeModel(model: GridModel, columns: number, rows: number): GridModel {
  if (columns === model.columns && rows === model.rows) return model;
  const next = createModel(columns, rows);
  const w = Math.min(columns, model.columns);
  const h = Math.min(rows, model.rows);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const from = cellIndex(model, col, row);
      const to = cellIndex(next, col, row);
      next.spokes[to] = model.spokes[from] ?? 0;
      next.edges[to] = model.edges[from] ?? ALL_LINES;
      next.vertices[to] = model.vertices[from] ?? 0;
      for (let t = 0; t < TRIANGLES_PER_CELL; t++) {
        next.triangles[to * TRIANGLES_PER_CELL + t] = model.triangles[from * TRIANGLES_PER_CELL + t] ?? 0;
      }
    }
  }
  return next;
}

export function modelFromBytes(
  columns: number,
  rows: number,
  spokes: readonly number[],
  edges: readonly number[] | undefined,
  vertices: readonly number[] | undefined,
  triangles: readonly number[] | undefined,
): GridModel {
  const model = createModel(columns, rows);
  spokes.forEach((b, i) => {
    model.spokes[i] = b & ALL_LINES;
  });
  edges?.forEach((b, i) => {
    model.edges[i] = b & ALL_LINES;
  });
  vertices?.forEach((b, i) => {
    model.vertices[i] = b & ALL_VERTICES;
  });
  triangles?.forEach((b, i) => {
    model.triangles[i] = b;
  });
  return model;
}
