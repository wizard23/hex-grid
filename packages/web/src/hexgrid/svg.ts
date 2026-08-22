import {
  cellCenter,
  cellVertex,
  gridCenter,
  neighbour,
  rotate,
  worldBounds,
  type Bounds,
  type Point,
} from "./geometry";
import { hasSpoke, type GridModel } from "./model";
import type { GridSettings, GridShape, GridStyle } from "./settings";

/**
 * Pure SVG generation in the world frame (mm). Used by the live preview and
 * by the export alike so both show exactly the same geometry.
 */
export type Segment = { a: Point; b: Point };

/** every hex edge exactly once: a cell emits edge k when k < 3 or there is no neighbour */
export function outlineSegments(shape: GridShape): Segment[] {
  const segments: Segment[] = [];
  const center = gridCenter(shape);
  for (let col = 0; col < shape.columns; col++) {
    for (let row = 0; row < shape.rows; row++) {
      for (let k = 0; k < 6; k++) {
        if (k >= 3 && neighbour(shape, col, row, k) !== null) continue;
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

/**
 * Spoke path data split into bands of `bandRows` rows, so that toggling one
 * spoke only rebuilds — and makes the browser re-parse — one band. A band is
 * reused from `previous` only when the shape, the dimensions and the band's
 * cell bytes are all unchanged.
 */
export type SpokeBands = { shapeKey: string; bandRows: number; model: GridModel; paths: string[] };

export function spokeBands(shape: GridShape, model: GridModel, bandRows: number, previous?: SpokeBands): SpokeBands {
  const shapeKey = `${shape.columns}/${shape.rows}/${shape.side}/${shape.orientationDeg}`;
  const reusable =
    previous !== undefined &&
    previous.shapeKey === shapeKey &&
    previous.bandRows === bandRows &&
    previous.model.columns === model.columns &&
    previous.model.rows === model.rows;
  const paths: string[] = [];
  for (let rowStart = 0, band = 0; rowStart < shape.rows; rowStart += bandRows, band++) {
    const rowEnd = Math.min(shape.rows, rowStart + bandRows);
    const cached = previous?.paths[band];
    if (reusable && cached !== undefined && sameBytes(previous.model, model, rowStart * model.columns, rowEnd * model.columns)) {
      paths.push(cached);
    } else {
      paths.push(toPathData(spokeSegments(shape, model, rowStart, rowEnd)));
    }
  }
  return { shapeKey, bandRows, model, paths };
}

function sameBytes(a: GridModel, b: GridModel, start: number, end: number): boolean {
  if (a.spokes === b.spokes) return true;
  for (let i = start; i < end; i++) if (a.spokes[i] !== b.spokes[i]) return false;
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

/** world bounds padded so the thickest stroke is not clipped */
export function documentBounds(settings: GridSettings): Bounds {
  const pad = Math.max(settings.outlineWidth, settings.spokeWidth) / 2;
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
    `<path d="${toPathData(outlineSegments(settings))}" ${strokeAttributes(style.outlineWidth, style.outlineColor)}/>`,
    `</svg>`,
  ];
  return { svg: lines.join("\n"), bounds };
}
