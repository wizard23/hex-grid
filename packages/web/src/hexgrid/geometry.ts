import type { GridShape } from "./settings";

/**
 * Hex geometry. The *local frame* is an unrotated flat-top grid (vertex k of a
 * cell sits at angle 60°·k, y pointing down) laid out in odd-q offset
 * coordinates: column `col` is at x = 1.5·side·col and odd columns are shifted
 * down by half a row. The *world frame* is the local frame rotated by the
 * orientation about the grid centre; it is what the SVG and the screen show.
 */
export type Point = { x: number; y: number };
export type Cell = { col: number; row: number };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export const SQRT3 = Math.sqrt(3);
const DEG = Math.PI / 180;

export function cellCenter(shape: GridShape, col: number, row: number): Point {
  return { x: 1.5 * shape.side * col, y: SQRT3 * shape.side * (row + (col & 1) / 2) };
}

/** vertex k (0..5) of a flat-top hex relative to its centre */
export function vertexOffset(side: number, k: number): Point {
  const a = 60 * k * DEG;
  return { x: side * Math.cos(a), y: side * Math.sin(a) };
}

export function cellVertex(shape: GridShape, col: number, row: number, k: number): Point {
  const c = cellCenter(shape, col, row);
  const v = vertexOffset(shape.side, k);
  return { x: c.x + v.x, y: c.y + v.y };
}

export function inGrid(shape: GridShape, col: number, row: number): boolean {
  return col >= 0 && col < shape.columns && row >= 0 && row < shape.rows;
}

// axial (q, r) step across edge k — the edge between vertex k and k+1
const AXIAL_STEP: readonly Point[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
];

function axialStep(k: number): Point {
  const step = AXIAL_STEP[((k % 6) + 6) % 6];
  if (step === undefined) throw new Error(`invalid edge index ${k}`);
  return step;
}

function offsetToAxial(col: number, row: number): Point {
  return { x: col, y: row - (col - (col & 1)) / 2 };
}

function axialToOffset(q: number, r: number): Cell {
  return { col: q, row: r + (q - (q & 1)) / 2 };
}

/** the cell across edge k, or null when it lies outside the grid */
export function neighbour(shape: GridShape, col: number, row: number, k: number): Cell | null {
  const a = offsetToAxial(col, row);
  const s = axialStep(k);
  const n = axialToOffset(a.x + s.x, a.y + s.y);
  return inGrid(shape, n.col, n.row) ? n : null;
}

/** the cell containing a local-frame point, or null when outside the grid */
export function cellAt(shape: GridShape, p: Point): Cell | null {
  const q = ((2 / 3) * p.x) / shape.side;
  const r = ((-1 / 3) * p.x + (SQRT3 / 3) * p.y) / shape.side;
  const rounded = axialRound(q, r);
  const cell = axialToOffset(rounded.x, rounded.y);
  return inGrid(shape, cell.col, cell.row) ? cell : null;
}

function axialRound(q: number, r: number): Point {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  // `+ 0` turns a -0 from the negation above into 0
  return { x: rq + 0, y: rr + 0 };
}

/** axis-aligned bounds of all cells in the local frame */
export function localBounds(shape: GridShape): Bounds {
  const { side, columns, rows } = shape;
  const halfRow = columns > 1 ? 0.5 : 0;
  return {
    minX: -side,
    maxX: 1.5 * side * (columns - 1) + side,
    minY: (-SQRT3 / 2) * side,
    maxY: SQRT3 * side * (rows - 1 + halfRow) + (SQRT3 / 2) * side,
  };
}

export function gridCenter(shape: GridShape): Point {
  const b = localBounds(shape);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** rotate p about `about` by `deg`, counter-clockwise as seen on screen (y down) */
export function rotate(p: Point, deg: number, about: Point): Point {
  const a = deg * DEG;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - about.x;
  const dy = p.y - about.y;
  return { x: about.x + dx * cos + dy * sin, y: about.y - dx * sin + dy * cos };
}

export function toWorld(shape: GridShape, local: Point): Point {
  return rotate(local, shape.orientationDeg, gridCenter(shape));
}

export function toLocal(shape: GridShape, world: Point): Point {
  return rotate(world, -shape.orientationDeg, gridCenter(shape));
}

/** tight bounds of all cell vertices in the world frame */
export function worldBounds(shape: GridShape): Bounds {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const center = gridCenter(shape);
  for (let col = 0; col < shape.columns; col++) {
    for (let row = 0; row < shape.rows; row++) {
      for (let k = 0; k < 6; k++) {
        const p = rotate(cellVertex(shape, col, row, k), shape.orientationDeg, center);
        if (p.x < b.minX) b.minX = p.x;
        if (p.x > b.maxX) b.maxX = p.x;
        if (p.y < b.minY) b.minY = p.y;
        if (p.y > b.maxY) b.maxY = p.y;
      }
    }
  }
  return b;
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  const dx = p.x - (a.x + t * abx);
  const dy = p.y - (a.y + t * aby);
  return Math.hypot(dx, dy);
}
