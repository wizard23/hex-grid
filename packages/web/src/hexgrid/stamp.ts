import { axialToCell, cellCenter, cellToAxial, canonicalEdge, canonicalVertex, inGrid, type Cell } from "./geometry";
import {
  ALL_LINES,
  ALL_VERTICES,
  CENTRE,
  cellIndex,
  createModel,
  hasEdge,
  hasVertex,
  spokesOf,
  triangleIndex,
  triangleState,
  TRIANGLES_PER_CELL,
  type GridModel,
} from "./model";
import type { GridSettings } from "./settings";
import {
  outlineSegments,
  spokeSegments,
  toDotPathData,
  toPathData,
  toPolygonPathData,
  toSvgDocument,
  triangleShapes,
  vertexPoints,
} from "./svg";
import { applyCell, applyElement, translation, type Isometry } from "./transform";

/**
 * A stamp: cells in axial coordinates relative to an anchor, each carrying its
 * complete element state — including the shared edges/corners on its boundary,
 * resolved from the source model, so a stamp is self-contained. The centre
 * (for symmetric tiling) is stored relative to the anchor as well.
 */
export type StampCell = {
  dq: number;
  dr: number;
  spokes: number;
  edges: number;
  vertices: number;
  triangles: number[];
};

export type StampCentreType = "cell" | "vertex" | "edge";
export type StampCentre = { type: StampCentreType; dq: number; dr: number; k: number };

export type Stamp = { cells: StampCell[]; centre?: StampCentre };

export function captureStamp(model: GridModel, cells: readonly Cell[], anchor: Cell, centre?: StampCentre): Stamp {
  const a = cellToAxial(anchor);
  const out: StampCell[] = cells.map((cell) => {
    const rel = cellToAxial(cell);
    let edges = 0;
    let vertices = 0;
    for (let k = 0; k < 6; k++) {
      if (hasEdge(model, cell.col, cell.row, k)) edges |= 1 << k;
      if (hasVertex(model, cell.col, cell.row, k)) vertices |= 1 << k;
    }
    if (hasVertex(model, cell.col, cell.row, CENTRE)) vertices |= 1 << CENTRE;
    return {
      dq: rel.q - a.q,
      dr: rel.r - a.r,
      spokes: spokesOf(model, cell.col, cell.row),
      edges,
      vertices,
      triangles: Array.from({ length: TRIANGLES_PER_CELL }, (_, t) => triangleState(model, cell.col, cell.row, t)),
    };
  });
  return centre === undefined ? { cells: out } : { cells: out, centre };
}

/** how a painter treats an element that would be written twice or is already set */
export type WritePolicy = "replace" | "merge" | "first-wins";

export type Painter = {
  setSpoke(cell: Cell, k: number, on: boolean, policy: WritePolicy): void;
  setEdge(cell: Cell, k: number, on: boolean, policy: WritePolicy): void;
  setVertex(cell: Cell, k: number, on: boolean, policy: WritePolicy): void;
  setTriangle(cell: Cell, t: number, state: number, policy: WritePolicy): void;
  finish(): { model: GridModel; conflicts: number };
};

/**
 * Batched writes into a copy of the model, with clipping to the grid,
 * canonical resolution of shared elements and, for "first-wins", conflict
 * counting: a later write of a *different* value to an already-written element
 * is dropped and counted.
 */
export function createPainter(model: GridModel): Painter {
  const cells = model.columns * model.rows;
  const next: GridModel = {
    columns: model.columns,
    rows: model.rows,
    spokes: new Uint8Array(model.spokes),
    edges: new Uint8Array(model.edges),
    vertices: new Uint8Array(model.vertices),
    triangles: new Uint8Array(model.triangles),
  };
  const writtenBits = {
    spokes: new Uint8Array(cells),
    edges: new Uint8Array(cells),
    vertices: new Uint8Array(cells),
    triangles: new Uint8Array(cells * TRIANGLES_PER_CELL),
  };
  let conflicts = 0;

  function setBit(kind: "spokes" | "edges" | "vertices", index: number, bit: number, on: boolean, policy: WritePolicy) {
    const mask = 1 << bit;
    const current = (next[kind][index] ?? 0) & mask;
    const value = on ? mask : 0;
    if (policy === "first-wins" && ((writtenBits[kind][index] ?? 0) & mask) !== 0) {
      if (current !== value) conflicts++;
      return;
    }
    writtenBits[kind][index] = (writtenBits[kind][index] ?? 0) | mask;
    if (policy === "merge" && !on) return; // merge only turns things on
    next[kind][index] = ((next[kind][index] ?? 0) & ~mask) | value;
  }

  return {
    setSpoke(cell, k, on, policy) {
      if (!inGrid(next, cell.col, cell.row)) return;
      setBit("spokes", cellIndex(next, cell.col, cell.row), k, on, policy);
    },
    setEdge(cell, k, on, policy) {
      if (!inGrid(next, cell.col, cell.row)) return;
      const e = canonicalEdge(next, cell.col, cell.row, k);
      setBit("edges", cellIndex(next, e.col, e.row), e.k, on, policy);
    },
    setVertex(cell, k, on, policy) {
      if (!inGrid(next, cell.col, cell.row)) return;
      const v = k === CENTRE ? { col: cell.col, row: cell.row, k } : canonicalVertex(next, cell.col, cell.row, k);
      setBit("vertices", cellIndex(next, v.col, v.row), v.k, on, policy);
    },
    setTriangle(cell, t, state, policy) {
      if (!inGrid(next, cell.col, cell.row)) return;
      const index = triangleIndex(next, cell.col, cell.row, t);
      const current = next.triangles[index] ?? 0;
      if (policy === "first-wins" && (writtenBits.triangles[index] ?? 0) !== 0) {
        if (current !== state) conflicts++;
        return;
      }
      writtenBits.triangles[index] = 1;
      if (policy === "merge" && state === 0) return;
      next.triangles[index] = state;
    },
    finish() {
      return { model: next, conflicts };
    },
  };
}

/**
 * Paint one copy of the stamp. `iso` maps the stamp's relative axial frame
 * (anchor at the origin) into absolute cells; build it as
 * compose(translation(target axial), point-group part about the origin).
 */
export function paintStamp(painter: Painter, stamp: Stamp, iso: Isometry, policy: WritePolicy): void {
  for (const sc of stamp.cells) {
    const virtual = axialToCell({ q: sc.dq, r: sc.dr });
    for (let k = 0; k < 6; k++) {
      const spoke = applyElement(iso, { kind: "spoke", col: virtual.col, row: virtual.row, k });
      painter.setSpoke(spoke, spoke.k, (sc.spokes & (1 << k)) !== 0, policy);
      const edge = applyElement(iso, { kind: "edge", col: virtual.col, row: virtual.row, k });
      painter.setEdge(edge, edge.k, (sc.edges & (1 << k)) !== 0, policy);
      const vertex = applyElement(iso, { kind: "vertex", col: virtual.col, row: virtual.row, k });
      painter.setVertex(vertex, vertex.k, (sc.vertices & (1 << k)) !== 0, policy);
      const triangle = applyElement(iso, { kind: "triangle", col: virtual.col, row: virtual.row, k });
      painter.setTriangle(triangle, triangle.k, sc.triangles[k] ?? 0, policy);
    }
    const centre = applyElement(iso, { kind: "vertex", col: virtual.col, row: virtual.row, k: CENTRE });
    painter.setVertex(centre, CENTRE, (sc.vertices & (1 << CENTRE)) !== 0, policy);
  }
}

/** one placed copy (used by Place mode) */
export function applyStamp(model: GridModel, stamp: Stamp, iso: Isometry, policy: "replace" | "merge"): GridModel {
  const painter = createPainter(model);
  paintStamp(painter, stamp, iso, policy);
  return painter.finish().model;
}

/**
 * Embed the stamp in a minimal standalone grid (for thumbnails and the stamp
 * editor): non-member cells carry no lines. Returns the model, the member cell
 * indices, and the isometry mapping stamp-relative axial coords into it.
 */
export function stampToDocumentModel(stamp: Stamp): { model: GridModel; members: Set<number>; embed: Isometry } {
  // shift columns first (an axial q-shift moves offset columns exactly);
  // an axial r-shift then moves every offset row uniformly
  const dq = -Math.min(0, ...stamp.cells.map((sc) => axialToCell({ q: sc.dq, r: sc.dr }).col));
  const dr = -Math.min(0, ...stamp.cells.map((sc) => axialToCell({ q: sc.dq + dq, r: sc.dr }).row));
  const embed = translation(dq, dr);
  const placed = stamp.cells.map((sc) => axialToCell({ q: sc.dq + dq, r: sc.dr + dr }));
  const columns = Math.max(1, ...placed.map((c) => c.col + 1));
  const rows = Math.max(1, ...placed.map((c) => c.row + 1));
  const model = createModel(columns, rows, 0, 0, 0);
  const painter = createPainter(model);
  paintStamp(painter, stamp, embed, "replace");
  const members = new Set(placed.map((c) => cellIndex(model, c.col, c.row)));
  return { model: painter.finish().model, members, embed };
}

/**
 * The stamp's drawing as path data in an unrotated local frame (used for the
 * placement ghost, which applies rotation/mirror/position as one SVG matrix).
 * `anchor` is the local position of the stamp's anchor cell centre.
 */
export type GhostPaths = {
  fills: { state: number; d: string }[];
  spokes: string;
  outline: string;
  dots: string;
  anchor: { x: number; y: number };
};

export function stampGhostPaths(stamp: Stamp, settings: GridSettings): GhostPaths {
  const { model, embed } = stampToDocumentModel(stamp);
  const shape = { ...settings, columns: model.columns, rows: model.rows, orientationDeg: 0 };
  const anchorCell = applyCell(embed, { col: 0, row: 0 });
  const fills: { state: number; d: string }[] = [];
  for (let state = 1; state < settings.stateCount; state++) {
    const d = toPolygonPathData(triangleShapes(shape, model, state));
    if (d !== "") fills.push({ state, d });
  }
  return {
    fills,
    spokes: toPathData(spokeSegments(shape, model)),
    outline: toPathData(outlineSegments(shape, model)),
    dots: toDotPathData(vertexPoints(shape, model), settings.vertexDiameter),
    anchor: cellCenter(shape, anchorCell.col, anchorCell.row),
  };
}

/** thumbnail SVG in the document's colours */
export function stampThumbnail(stamp: Stamp, settings: GridSettings): string {
  const { model } = stampToDocumentModel(stamp);
  return toSvgDocument({ ...settings, columns: model.columns, rows: model.rows }, model).svg;
}

// ---- library JSON (export/import of the whole palette)

/** the symmetry a stamp was last tiled with; its centre is `stamp.centre` */
export type StampSymmetry = { name: string; u: { q: number; r: number }; v: { q: number; r: number } };

export type StoredStamp = {
  id: string;
  name: string;
  createdAt: number;
  modifiedAt: number;
  stamp: Stamp;
  symmetry?: StampSymmetry;
};

const LIBRARY_FORMAT = "hex-grid-stamps";
const LIBRARY_VERSION = 1;

export function libraryToJson(stamps: readonly StoredStamp[]): string {
  return JSON.stringify({ format: LIBRARY_FORMAT, version: LIBRARY_VERSION, stamps }, null, 1);
}

export function parseLibrary(text: string): StoredStamp[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("not valid JSON");
  }
  if (!isRecord(raw) || raw.format !== LIBRARY_FORMAT) throw new Error("not a stamp library file");
  if (raw.version !== LIBRARY_VERSION) throw new Error(`unsupported version ${String(raw.version)}`);
  if (!Array.isArray(raw.stamps)) throw new Error("missing stamps");
  return raw.stamps.map(parseStoredStamp);
}

function parseStoredStamp(raw: unknown): StoredStamp {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.name !== "string") throw new Error("bad stamp entry");
  const stamp = parseStamp(raw.stamp);
  const entry: StoredStamp = {
    id: raw.id,
    name: raw.name,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : 0,
    modifiedAt: typeof raw.modifiedAt === "number" ? raw.modifiedAt : 0,
    stamp,
  };
  const sym = raw.symmetry;
  if (isRecord(sym) && typeof sym.name === "string" && isAxial(sym.u) && isAxial(sym.v)) {
    entry.symmetry = { name: sym.name, u: sym.u, v: sym.v };
  }
  return entry;
}

function isAxial(value: unknown): value is { q: number; r: number } {
  return isRecord(value) && Number.isInteger(value.q) && Number.isInteger(value.r);
}

export function parseStamp(raw: unknown): Stamp {
  if (!isRecord(raw) || !Array.isArray(raw.cells) || raw.cells.length === 0) throw new Error("stamp has no cells");
  const cells = raw.cells.map((c) => {
    if (
      !isRecord(c) ||
      typeof c.dq !== "number" ||
      !Number.isInteger(c.dq) ||
      typeof c.dr !== "number" ||
      !Number.isInteger(c.dr) ||
      !isByte(c.spokes) ||
      !isByte(c.edges) ||
      !isByte(c.vertices) ||
      !Array.isArray(c.triangles) ||
      c.triangles.length !== TRIANGLES_PER_CELL ||
      !c.triangles.every(isByte)
    ) {
      throw new Error("bad stamp cell");
    }
    return {
      dq: c.dq,
      dr: c.dr,
      spokes: c.spokes & ALL_LINES,
      edges: c.edges & ALL_LINES,
      vertices: c.vertices & ALL_VERTICES,
      triangles: c.triangles.filter(isByte),
    };
  });
  const centre = isRecord(raw.centre) ? (raw.centre as StampCentre) : undefined;
  return centre === undefined ? { cells } : { cells, centre };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isByte(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
}
