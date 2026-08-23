import {
  canonicalVertex,
  cellCenter,
  cellVertex,
  gridCenter,
  neighbour,
  rotate,
  worldBounds,
  type Bounds,
  type Point,
} from "./geometry";
import { bytesOf, CENTRE, hasEdge, hasSpoke, hasVertex, type ElementKind, type GridModel, type LineKind } from "./model";
import type { GridSettings, GridShape, GridStyle } from "./settings";

/**
 * Pure SVG generation in the world frame (mm). Used by the live preview and
 * by the export alike so both show exactly the same geometry.
 */
export type Segment = { a: Point; b: Point };

/**
 * The drawn hex edges, every edge exactly once: a cell emits edge k only when
 * it owns it (k < 3, or there is no neighbour across it). Optionally only for
 * the cells in rows [rowStart, rowEnd).
 */
export function outlineSegments(shape: GridShape, model: GridModel, rowStart = 0, rowEnd = shape.rows): Segment[] {
  const segments: Segment[] = [];
  const center = gridCenter(shape);
  for (let col = 0; col < shape.columns; col++) {
    for (let row = rowStart; row < rowEnd; row++) {
      for (let k = 0; k < 6; k++) {
        if (k >= 3 && neighbour(shape, col, row, k) !== null) continue;
        if (!hasEdge(model, col, row, k)) continue;
        segments.push({
          a: rotate(cellVertex(shape, col, row, k), shape.orientationDeg, center),
          b: rotate(cellVertex(shape, col, row, k + 1), shape.orientationDeg, center),
        });
      }
    }
  }
  return segments;
}

/** the enabled centre → vertex lines (optionally only for rows in [rowStart, rowEnd)) */
export function spokeSegments(shape: GridShape, model: GridModel, rowStart = 0, rowEnd = shape.rows): Segment[] {
  const segments: Segment[] = [];
  const center = gridCenter(shape);
  for (let col = 0; col < shape.columns; col++) {
    for (let row = rowStart; row < rowEnd; row++) {
      const c = cellCenter(shape, col, row);
      for (let k = 0; k < 6; k++) {
        if (!hasSpoke(model, col, row, k)) continue;
        segments.push({
          a: rotate(c, shape.orientationDeg, center),
          b: rotate(cellVertex(shape, col, row, k), shape.orientationDeg, center),
        });
      }
    }
  }
  return segments;
}

export function lineSegments(
  kind: LineKind,
  shape: GridShape,
  model: GridModel,
  rowStart?: number,
  rowEnd?: number,
): Segment[] {
  return kind === "spoke"
    ? spokeSegments(shape, model, rowStart, rowEnd)
    : outlineSegments(shape, model, rowStart, rowEnd);
}

/**
 * The drawn dots (cell centres and corners), every corner exactly once: a cell
 * emits corner k only when it owns it. Optionally only for rows in
 * [rowStart, rowEnd).
 */
export function vertexPoints(shape: GridShape, model: GridModel, rowStart = 0, rowEnd = shape.rows): Point[] {
  const points: Point[] = [];
  const center = gridCenter(shape);
  for (let col = 0; col < shape.columns; col++) {
    for (let row = rowStart; row < rowEnd; row++) {
      if (hasVertex(model, col, row, CENTRE)) {
        points.push(rotate(cellCenter(shape, col, row), shape.orientationDeg, center));
      }
      for (let k = 0; k < 6; k++) {
        const owner = canonicalVertex(shape, col, row, k);
        if (owner.col !== col || owner.row !== row || owner.k !== k) continue;
        if (!hasVertex(model, col, row, k)) continue;
        points.push(rotate(cellVertex(shape, col, row, k), shape.orientationDeg, center));
      }
    }
  }
  return points;
}

/** filled circles as one path: two arcs per dot */
export function toDotPathData(points: readonly Point[], diameter: number): string {
  const r = diameter / 2;
  const parts: string[] = [];
  for (const { x, y } of points) {
    const rr = fmt(r);
    parts.push(`M${fmt(x + r)} ${fmt(y)}A${rr} ${rr} 0 1 0 ${fmt(x - r)} ${fmt(y)}A${rr} ${rr} 0 1 0 ${fmt(x + r)} ${fmt(y)}Z`);
  }
  return parts.join("");
}

function elementPathData(kind: ElementKind, settings: GridSettings, model: GridModel, rowStart: number, rowEnd: number): string {
  return kind === "vertex"
    ? toDotPathData(vertexPoints(settings, model, rowStart, rowEnd), settings.vertexDiameter)
    : toPathData(lineSegments(kind, settings, model, rowStart, rowEnd));
}

/**
 * Path data for one element kind split into bands of `bandRows` rows, so that
 * toggling one element only rebuilds — and makes the browser re-parse — one
 * band. A band is reused from `previous` only when the kind, the geometry
 * (shape, and the dot diameter for vertices), the dimensions and the band's
 * cell bytes are all unchanged.
 */
export type PathBands = { kind: ElementKind; geometryKey: string; bandRows: number; model: GridModel; paths: string[] };

export function pathBands(
  kind: ElementKind,
  settings: GridSettings,
  model: GridModel,
  bandRows: number,
  previous?: PathBands,
): PathBands {
  const { columns, rows, side, orientationDeg, vertexDiameter } = settings;
  const geometryKey = `${columns}/${rows}/${side}/${orientationDeg}/${kind === "vertex" ? vertexDiameter : ""}`;
  const reusable =
    previous !== undefined &&
    previous.kind === kind &&
    previous.geometryKey === geometryKey &&
    previous.bandRows === bandRows &&
    previous.model.columns === model.columns &&
    previous.model.rows === model.rows
      ? previous
      : undefined;
  const bytes = bytesOf(model, kind);
  const paths: string[] = [];
  for (let rowStart = 0, band = 0; rowStart < rows; rowStart += bandRows, band++) {
    const rowEnd = Math.min(rows, rowStart + bandRows);
    const cached = reusable?.paths[band];
    if (
      reusable !== undefined &&
      cached !== undefined &&
      sameBytes(bytesOf(reusable.model, kind), bytes, rowStart * columns, rowEnd * columns)
    ) {
      paths.push(cached);
    } else {
      paths.push(elementPathData(kind, settings, model, rowStart, rowEnd));
    }
  }
  return { kind, geometryKey, bandRows, model, paths };
}

function sameBytes(a: Uint8Array, b: Uint8Array, start: number, end: number): boolean {
  if (a === b) return true;
  for (let i = start; i < end; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** mm with µm precision, no trailing zeros */
export function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

export function toPathData(segments: readonly Segment[]): string {
  const parts: string[] = [];
  for (const { a, b } of segments) {
    parts.push(`M${fmt(a.x)} ${fmt(a.y)}L${fmt(b.x)} ${fmt(b.y)}`);
  }
  return parts.join("");
}

/** world bounds padded so the thickest stroke / largest dot is not clipped */
export function documentBounds(settings: GridSettings): Bounds {
  const pad = Math.max(settings.outlineWidth, settings.spokeWidth, settings.vertexDiameter) / 2;
  const b = worldBounds(settings);
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}

export function strokeAttributes(width: number, color: string): string {
  return `fill="none" stroke="${escapeAttribute(color)}" stroke-width="${fmt(width)}" stroke-linecap="round" stroke-linejoin="round"`;
}

export function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export type SvgDocument = { svg: string; bounds: Bounds };

export function toSvgDocument(settings: GridSettings, model: GridModel): SvgDocument {
  const bounds = documentBounds(settings);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const viewBox = `${fmt(bounds.minX)} ${fmt(bounds.minY)} ${fmt(width)} ${fmt(height)}`;
  const style: GridStyle = settings;
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}mm" height="${fmt(height)}mm" viewBox="${viewBox}">`,
    `<rect x="${fmt(bounds.minX)}" y="${fmt(bounds.minY)}" width="${fmt(width)}" height="${fmt(height)}" fill="${escapeAttribute(style.backgroundColor)}"/>`,
    `<path d="${toPathData(spokeSegments(settings, model))}" ${strokeAttributes(style.spokeWidth, style.spokeColor)}/>`,
    `<path d="${toPathData(outlineSegments(settings, model))}" ${strokeAttributes(style.outlineWidth, style.outlineColor)}/>`,
    `<path d="${toDotPathData(vertexPoints(settings, model), style.vertexDiameter)}" fill="${escapeAttribute(style.vertexColor)}"/>`,
    `</svg>`,
  ];
  return { svg: lines.join("\n"), bounds };
}
