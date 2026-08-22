import { cellAt, cellCenter, cellVertex, distanceToSegment, toLocal, type Point } from "./geometry";
import type { GridShape } from "./settings";

export type SpokeHit = { col: number; row: number; k: number };

/**
 * The spoke (centre → vertex k) closest to a world-frame point, if it lies
 * within `tolerance` (world units, i.e. mm) of the point. Pure arithmetic —
 * no per-spoke DOM elements are needed for hover and click.
 */
export function hitSpoke(shape: GridShape, world: Point, tolerance: number): SpokeHit | null {
  const p = toLocal(shape, world);
  const cell = cellAt(shape, p);
  if (cell === null) return null;
  const c = cellCenter(shape, cell.col, cell.row);
  const angle = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;
  const k = ((Math.round(angle / 60) % 6) + 6) % 6;
  const v = cellVertex(shape, cell.col, cell.row, k);
  if (distanceToSegment(p, c, v) > tolerance) return null;
  return { col: cell.col, row: cell.row, k };
}
