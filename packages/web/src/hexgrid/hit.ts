import {
  canonicalEdge,
  canonicalVertex,
  cellAt,
  cellCenter,
  cellVertex,
  distanceToSegment,
  toLocal,
  type Point,
} from "./geometry";
import { CENTRE, type ElementKind } from "./model";
import type { GridShape } from "./settings";

/**
 * A spoke (centre → corner k), a hex edge (corner k → k+1, canonical owner)
 * or a vertex (corner k, canonical owner, or the centre k = CENTRE).
 */
export type ElementHit = { kind: ElementKind; col: number; row: number; k: number };

/**
 * The element under a world-frame point: a vertex when one lies within
 * `vertexRadius`, otherwise the closest line within `lineTolerance` (both in
 * world units, i.e. mm). Pure arithmetic — no per-element DOM is needed for
 * hover and click. Shared edges and corners are reported by their canonical
 * owner so hovering from any side names the same element.
 */
export function hitElement(shape: GridShape, world: Point, lineTolerance: number, vertexRadius: number): ElementHit | null {
  const p = toLocal(shape, world);
  const cell = cellAt(shape, p);
  if (cell === null) return null;
  const { col, row } = cell;
  const c = cellCenter(shape, col, row);

  let nearestVertex = CENTRE;
  let vertexDistance = Math.hypot(p.x - c.x, p.y - c.y);
  for (let k = 0; k < 6; k++) {
    const v = cellVertex(shape, col, row, k);
    const d = Math.hypot(p.x - v.x, p.y - v.y);
    if (d < vertexDistance) {
      vertexDistance = d;
      nearestVertex = k;
    }
  }
  if (vertexDistance <= vertexRadius) {
    const owner = nearestVertex === CENTRE ? { col, row, k: CENTRE } : canonicalVertex(shape, col, row, nearestVertex);
    return { kind: "vertex", ...owner };
  }

  const angle = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;
  const turns = ((angle / 60) % 6) + 6;
  const spokeK = Math.round(turns) % 6;
  const spokeDistance = distanceToSegment(p, c, cellVertex(shape, col, row, spokeK));
  const edgeK = Math.floor(turns) % 6;
  const edgeDistance = distanceToSegment(p, cellVertex(shape, col, row, edgeK), cellVertex(shape, col, row, edgeK + 1));

  if (spokeDistance <= edgeDistance) {
    return spokeDistance <= lineTolerance ? { kind: "spoke", col, row, k: spokeK } : null;
  }
  if (edgeDistance > lineTolerance) return null;
  return { kind: "edge", ...canonicalEdge(shape, col, row, edgeK) };
}
