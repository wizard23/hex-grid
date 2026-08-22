import { canonicalEdge, cellAt, cellCenter, cellVertex, distanceToSegment, toLocal, type Point } from "./geometry";
import type { LineKind } from "./model";
import type { GridShape } from "./settings";

/** a spoke (centre → vertex k) or a hex edge (vertex k → k+1, canonical owner) */
export type LineHit = { kind: LineKind; col: number; row: number; k: number };

/**
 * The line closest to a world-frame point, if it lies within `tolerance`
 * (world units, i.e. mm). Pure arithmetic — no per-line DOM elements are
 * needed for hover and click. Edges are reported by their canonical owner so
 * hovering from either side names the same edge.
 */
export function hitLine(shape: GridShape, world: Point, tolerance: number): LineHit | null {
  const p = toLocal(shape, world);
  const cell = cellAt(shape, p);
  if (cell === null) return null;
  const c = cellCenter(shape, cell.col, cell.row);
  const angle = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;
  const turns = ((angle / 60) % 6) + 6;

  const spokeK = Math.round(turns) % 6;
  const spokeDistance = distanceToSegment(p, c, cellVertex(shape, cell.col, cell.row, spokeK));

  const edgeK = Math.floor(turns) % 6;
  const edgeDistance = distanceToSegment(
    p,
    cellVertex(shape, cell.col, cell.row, edgeK),
    cellVertex(shape, cell.col, cell.row, edgeK + 1),
  );

  if (spokeDistance <= edgeDistance) {
    return spokeDistance <= tolerance ? { kind: "spoke", col: cell.col, row: cell.row, k: spokeK } : null;
  }
  if (edgeDistance > tolerance) return null;
  return { kind: "edge", ...canonicalEdge(shape, cell.col, cell.row, edgeK) };
}
