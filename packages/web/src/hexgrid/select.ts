import {
  axialToCell,
  canonicalEdge,
  canonicalVertex,
  cellAt,
  cellCenter,
  cellToAxial,
  cellVertex,
  neighbour,
  toLocal,
  toWorld,
  type Cell,
  type Point,
} from "./geometry";
import { CENTRE, type ElementKind } from "./model";
import type { StampCentre } from "./stamp";
import type { GridShape, GridSize } from "./settings";

/**
 * A symmetry centre on the grid: a cell centre, a corner (canonical owner) or
 * an edge midpoint (canonical owner). Set by double-clicking in select mode.
 */
export type CentreRef = { type: "cell" | "vertex" | "edge"; col: number; row: number; k: number };

/** the centre candidate nearest to a world-frame point, or null outside the grid */
export function nearestCentre(shape: GridShape, world: Point): CentreRef | null {
  const p = toLocal(shape, world);
  const cell = cellAt(shape, p);
  if (cell === null) return null;
  const { col, row } = cell;
  const c = cellCenter(shape, col, row);
  let best: CentreRef = { type: "cell", col, row, k: 0 };
  let bestDistance = Math.hypot(p.x - c.x, p.y - c.y);
  for (let k = 0; k < 6; k++) {
    const v = cellVertex(shape, col, row, k);
    const dv = Math.hypot(p.x - v.x, p.y - v.y);
    if (dv < bestDistance) {
      bestDistance = dv;
      best = { type: "vertex", ...canonicalVertex(shape, col, row, k) };
    }
    const w = cellVertex(shape, col, row, k + 1);
    const m = { x: (v.x + w.x) / 2, y: (v.y + w.y) / 2 };
    const dm = Math.hypot(p.x - m.x, p.y - m.y);
    if (dm < bestDistance) {
      bestDistance = dm;
      best = { type: "edge", ...canonicalEdge(shape, col, row, k) };
    }
  }
  return best;
}

/** world-frame position of a centre (for the marker and for transforms) */
export function centrePoint(shape: GridShape, ref: CentreRef): Point {
  if (ref.type === "cell") return toWorld(shape, cellCenter(shape, ref.col, ref.row));
  if (ref.type === "vertex") return toWorld(shape, cellVertex(shape, ref.col, ref.row, ref.k));
  const a = cellVertex(shape, ref.col, ref.row, ref.k);
  const b = cellVertex(shape, ref.col, ref.row, ref.k + 1);
  return toWorld(shape, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
}

/** resolve a stamp-relative centre back to grid coordinates */
export function fromStampCentre(centre: StampCentre, anchor: Cell): CentreRef {
  const a = cellToAxial(anchor);
  const cell = axialToCell({ q: a.q + centre.dq, r: a.r + centre.dr });
  return { type: centre.type, col: cell.col, row: cell.row, k: centre.k };
}

/** whether an element belongs to (touches) one of the member cells */
export function elementTouchesMember(
  grid: GridSize,
  el: { kind: ElementKind; col: number; row: number; k: number },
  isMember: (cell: Cell) => boolean,
): boolean {
  if (isMember(el)) return true;
  if (el.kind === "edge") {
    const n = neighbour(grid, el.col, el.row, el.k);
    return n !== null && isMember(n);
  }
  if (el.kind === "vertex" && el.k !== CENTRE) {
    const across = neighbour(grid, el.col, el.row, el.k);
    const before = neighbour(grid, el.col, el.row, el.k + 5);
    return (across !== null && isMember(across)) || (before !== null && isMember(before));
  }
  return false;
}

/** store a centre relative to a stamp anchor */
export function toStampCentre(ref: CentreRef, anchor: Cell): StampCentre {
  const c = cellToAxial({ col: ref.col, row: ref.row });
  const a = cellToAxial(anchor);
  return { type: ref.type, dq: c.q - a.q, dr: c.r - a.r, k: ref.k };
}

/** the world-frame hexagon outlines of a set of cells, as one path (selection overlay) */
export function cellPolygonPath(shape: GridShape, cells: Iterable<Cell>): string {
  const parts: string[] = [];
  for (const { col, row } of cells) {
    const points: string[] = [];
    for (let k = 0; k < 6; k++) {
      const p = toWorld(shape, cellVertex(shape, col, row, k));
      points.push(`${p.x} ${p.y}`);
    }
    parts.push(`M${points.join("L")}Z`);
  }
  return parts.join("");
}
