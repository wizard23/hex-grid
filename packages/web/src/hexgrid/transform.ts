import {
  axialToCell,
  canonicalEdge,
  canonicalVertex,
  cellAt,
  cellCenter,
  cellToAxial,
  cellVertex,
  neighbour,
  UNBOUNDED,
  type AxialCell,
  type Cell,
  type Point,
} from "./geometry";
import { CENTRE, type ElementKind } from "./model";
import type { GridShape } from "./settings";

/**
 * Exact isometries of the hex lattice, in axial coordinates: p ↦ M·p + t with
 * an integer 2×2 matrix M from the point group D6 and an integer translation
 * t. Rotation/mirror centres may be cell centres, corners or edge midpoints;
 * they are passed in SIXTHS of axial units so everything stays integer.
 * Constructors throw when the requested map does not preserve the lattice
 * (e.g. a 60° rotation about a corner).
 */
export type Axial = AxialCell;
export type Isometry = {
  readonly a: number; // q' = a·q + b·r + tq
  readonly b: number;
  readonly c: number; // r' = c·q + d·r + tr
  readonly d: number;
  readonly tq: number;
  readonly tr: number;
};

export const IDENTITY: Isometry = { a: 1, b: 0, c: 0, d: 1, tq: 0, tr: 0 };

/** rotation by 60° counter-clockwise on screen: maps axial step k to step k+1 */
const R60 = { a: 0, b: -1, c: 1, d: 1 };
/** mirror across the axis through two opposite corners of a cell (pixel angle 0°) */
const M0 = { a: 1, b: 0, c: -1, d: -1 };

export function translation(dq: number, dr: number): Isometry {
  return { ...IDENTITY, tq: dq, tr: dr };
}

export function compose(f: Isometry, g: Isometry): Isometry {
  // (f ∘ g)(p) = f(g(p))
  return {
    a: f.a * g.a + f.b * g.c,
    b: f.a * g.b + f.b * g.d,
    c: f.c * g.a + f.d * g.c,
    d: f.c * g.b + f.d * g.d,
    tq: f.a * g.tq + f.b * g.tr + f.tq,
    tr: f.c * g.tq + f.d * g.tr + f.tr,
  };
}

export function invert(iso: Isometry): Isometry {
  const det = iso.a * iso.d - iso.b * iso.c; // ±1 for lattice isometries
  const a = iso.d / det;
  const b = -iso.b / det;
  const c = -iso.c / det;
  const d = iso.a / det;
  return { a, b, c, d, tq: -(a * iso.tq + b * iso.tr), tr: -(c * iso.tq + d * iso.tr) };
}

export function isometryKey(iso: Isometry): string {
  return `${iso.a},${iso.b},${iso.c},${iso.d},${iso.tq},${iso.tr}`;
}

function linearPower(m: { a: number; b: number; c: number; d: number }, k: number): Isometry {
  let result = IDENTITY;
  for (let i = 0; i < k; i++) result = compose({ ...m, tq: 0, tr: 0 }, result);
  return result;
}

/** the point about which to rotate/mirror, in sixths of axial units */
export function cellPoint6(cell: Cell): Axial {
  const a = cellToAxial(cell);
  return { q: 6 * a.q, r: 6 * a.r };
}

// corner k of a cell, as an axial offset from the centre in sixths (thirds × 6)
const CORNER_AXIAL6: readonly Axial[] = [
  { q: 4, r: -2 },
  { q: 2, r: 2 },
  { q: -2, r: 4 },
  { q: -4, r: 2 },
  { q: -2, r: -2 },
  { q: 2, r: -4 },
];

export function cornerPoint6(cell: Cell, k: number): Axial {
  const c = cellPoint6(cell);
  const o = CORNER_AXIAL6[((k % 6) + 6) % 6];
  if (o === undefined) throw new Error(`invalid corner ${k}`);
  return { q: c.q + o.q, r: c.r + o.r };
}

/** midpoint of edge k (between corner k and k+1) in sixths */
export function edgeMidpoint6(cell: Cell, k: number): Axial {
  const n = neighbour(UNBOUNDED, cell.col, cell.row, k);
  if (n === null) throw new Error("unreachable: UNBOUNDED has all neighbours");
  const a = cellPoint6(cell);
  const b = cellPoint6(n);
  return { q: (a.q + b.q) / 2, r: (a.r + b.r) / 2 };
}

function fixedPointMap(m: { a: number; b: number; c: number; d: number }, about6: Axial, what: string): Isometry {
  // t = about − M·about, computed in sixths and required to be integer axial
  const tq6 = about6.q - (m.a * about6.q + m.b * about6.r);
  const tr6 = about6.r - (m.c * about6.q + m.d * about6.r);
  if (tq6 % 6 !== 0 || tr6 % 6 !== 0) throw new Error(`${what} does not preserve the hex lattice`);
  return { ...m, tq: tq6 / 6, tr: tr6 / 6 };
}

/** rotation by k·60° about a point given in sixths (cell centre, corner or edge midpoint) */
export function rotationAbout(about6: Axial, k: number): Isometry {
  const m = linearPower(R60, ((k % 6) + 6) % 6);
  return fixedPointMap(m, about6, `rotation by ${k * 60}° about (${about6.q}/6, ${about6.r}/6)`);
}

/**
 * mirror across the axis through `about6` at pixel angle 30°·axis
 * (axis 0, 2, 4 run through opposite corners of a cell; 1, 3, 5 through
 * opposite edge midpoints)
 */
export function reflectionAbout(about6: Axial, axis: number): Isometry {
  const k = ((axis % 6) + 6) % 6;
  // mirror at angle 30°k = R60^k ∘ M0 ∘ R60^−k when k is even; for odd k the
  // half-step is M0 conjugated by R60^((k−1)/2) composed with an extra R60:
  // R(15°) is not in the group, so build it as R60^k ∘ M0 (angle of that
  // mirror is 30°·k, since R^k·M0 is a reflection whose axis bisects).
  const m = compose(linearPower(R60, k), { ...M0, tq: 0, tr: 0 });
  return fixedPointMap(m, about6, `mirror at ${30 * k}° about (${about6.q}/6, ${about6.r}/6)`);
}

export function applyAxial(iso: Isometry, p: Axial): Axial {
  return { q: iso.a * p.q + iso.b * p.r + iso.tq, r: iso.c * p.q + iso.d * p.r + iso.tr };
}

/** the same map on points given in sixths (integral because iso is integral) */
export function applyAxial6(iso: Isometry, p6: Axial): Axial {
  return { q: iso.a * p6.q + iso.b * p6.r + 6 * iso.tq, r: iso.c * p6.q + iso.d * p6.r + 6 * iso.tr };
}

export function applyCell(iso: Isometry, cell: Cell): Cell {
  return axialToCell(applyAxial(iso, cellToAxial(cell)));
}

export type ElementRef = { kind: ElementKind; col: number; row: number; k: number };

// the unit lattice used to resolve mapped geometry (side 1, no rotation, unbounded)
const UNIT: GridShape = { columns: Infinity, rows: Infinity, side: 1, orientationDeg: 0 };

/** the isometry as a map on unit-lattice pixel points */
export function applyPoint(iso: Isometry, p: Point): Point {
  // pixel → axial (exact linear inverse of cellCenter with side 1)
  const q = (2 / 3) * p.x;
  const r = -p.x / 3 + (Math.sqrt(3) / 3) * p.y;
  const m = applyAxial(iso, { q, r });
  return { x: 1.5 * m.q, y: Math.sqrt(3) * (m.r + m.q / 2) };
}

function cornerIndexAt(cell: Cell, p: Point): number {
  const c = cellCenter(UNIT, cell.col, cell.row);
  const angle = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;
  return ((Math.round(angle / 60) % 6) + 6) % 6;
}

/**
 * Map an element reference. Shared edges/corners come back canonicalised for
 * the unbounded lattice (edge k < 3; corner owned by the smallest-index view),
 * so equal elements map to equal references regardless of which cell named
 * them. Works for any integer cells, including negative ones.
 */
export function applyElement(iso: Isometry, el: ElementRef): ElementRef {
  const cell = { col: el.col, row: el.row };
  if (el.kind === "vertex" && el.k === CENTRE) {
    const c = applyCell(iso, cell);
    return { kind: "vertex", col: c.col, row: c.row, k: CENTRE };
  }
  const centreImage = applyPoint(iso, cellCenter(UNIT, cell.col, cell.row));
  const home = cellAt(UNIT, centreImage);
  if (home === null) throw new Error("unreachable: UNIT is unbounded");
  const kImage = cornerIndexAt(home, applyPoint(iso, cellVertex(UNIT, cell.col, cell.row, el.k)));
  if (el.kind === "spoke") return { kind: "spoke", col: home.col, row: home.row, k: kImage };
  if (el.kind === "vertex") return { kind: "vertex", ...canonicalVertex(UNBOUNDED, home.col, home.row, kImage) };
  // edges and triangles span corners k and k+1: orientation decides the index
  const nextImage = cornerIndexAt(home, applyPoint(iso, cellVertex(UNIT, cell.col, cell.row, el.k + 1)));
  const k = nextImage === (kImage + 1) % 6 ? kImage : nextImage;
  if (el.kind === "triangle") return { kind: "triangle", col: home.col, row: home.row, k };
  return { kind: "edge", ...canonicalEdge(UNBOUNDED, home.col, home.row, k) };
}
