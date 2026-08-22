/**
 * Per-cell state: one byte per cell, bit k set ⇔ the spoke from the cell
 * centre to vertex k is drawn. Models are treated as immutable values; every
 * update returns a fresh copy (cheap: one byte per cell).
 */
export const SPOKE_COUNT = 6;
export const ALL_SPOKES = (1 << SPOKE_COUNT) - 1;

export type GridModel = {
  readonly columns: number;
  readonly rows: number;
  readonly spokes: Uint8Array;
};

export function createModel(columns: number, rows: number, fill = 0): GridModel {
  const spokes = new Uint8Array(columns * rows);
  if (fill !== 0) spokes.fill(fill & ALL_SPOKES);
  return { columns, rows, spokes };
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

export function toggleSpoke(model: GridModel, col: number, row: number, k: number): GridModel {
  const spokes = new Uint8Array(model.spokes);
  const i = cellIndex(model, col, row);
  spokes[i] = (spokes[i] ?? 0) ^ (1 << k);
  return { ...model, spokes };
}

export function fillModel(model: GridModel, bits: number): GridModel {
  return createModel(model.columns, model.rows, bits);
}

/** change dimensions, keeping the state of every cell that still exists */
export function resizeModel(model: GridModel, columns: number, rows: number): GridModel {
  if (columns === model.columns && rows === model.rows) return model;
  const next = createModel(columns, rows);
  const w = Math.min(columns, model.columns);
  const h = Math.min(rows, model.rows);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      next.spokes[cellIndex(next, col, row)] = spokesOf(model, col, row);
    }
  }
  return next;
}

export function modelFromBytes(columns: number, rows: number, bytes: readonly number[]): GridModel {
  const model = createModel(columns, rows);
  bytes.forEach((b, i) => {
    model.spokes[i] = b & ALL_SPOKES;
  });
  return model;
}
