import { canonicalEdge } from "./geometry";

/**
 * Per-cell state, two bytes per cell:
 * - `spokes`: bit k set ⇔ the line from the cell centre to vertex k is drawn;
 * - `edges`: bit k set ⇔ the hex edge between vertex k and k+1 is drawn. Shared
 *   edges are stored once, on their canonical owner (see `canonicalEdge`).
 * Models are treated as immutable values; every update returns a fresh copy.
 */
export const LINE_COUNT = 6;
export const ALL_LINES = (1 << LINE_COUNT) - 1;

export type GridModel = {
  readonly columns: number;
  readonly rows: number;
  readonly spokes: Uint8Array;
  readonly edges: Uint8Array;
};

export type LineKind = "spoke" | "edge";

export function createModel(columns: number, rows: number, spokes = 0, edges = ALL_LINES): GridModel {
  const cells = columns * rows;
  return {
    columns,
    rows,
    spokes: new Uint8Array(cells).fill(spokes & ALL_LINES),
    edges: new Uint8Array(cells).fill(edges & ALL_LINES),
  };
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

export function hasLine(model: GridModel, kind: LineKind, col: number, row: number, k: number): boolean {
  return kind === "spoke" ? hasSpoke(model, col, row, k) : hasEdge(model, col, row, k);
}

export function toggleSpoke(model: GridModel, col: number, row: number, k: number): GridModel {
  const spokes = new Uint8Array(model.spokes);
  const i = cellIndex(model, col, row);
  spokes[i] = (spokes[i] ?? 0) ^ (1 << k);
  return { ...model, spokes };
}

export function toggleEdge(model: GridModel, col: number, row: number, k: number): GridModel {
  const e = canonicalEdge(model, col, row, k);
  const edges = new Uint8Array(model.edges);
  const i = cellIndex(model, e.col, e.row);
  edges[i] = (edges[i] ?? 0) ^ (1 << e.k);
  return { ...model, edges };
}

export function toggleLine(model: GridModel, kind: LineKind, col: number, row: number, k: number): GridModel {
  return kind === "spoke" ? toggleSpoke(model, col, row, k) : toggleEdge(model, col, row, k);
}

export function fillModel(model: GridModel, spokes: number, edges: number): GridModel {
  return createModel(model.columns, model.rows, spokes, edges);
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
    }
  }
  return next;
}

export function modelFromBytes(
  columns: number,
  rows: number,
  spokes: readonly number[],
  edges: readonly number[] | undefined,
): GridModel {
  const model = createModel(columns, rows);
  spokes.forEach((b, i) => {
    model.spokes[i] = b & ALL_LINES;
  });
  edges?.forEach((b, i) => {
    model.edges[i] = b & ALL_LINES;
  });
  return model;
}
