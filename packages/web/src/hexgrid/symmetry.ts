import { cellCenter, cellToAxial, inGrid, type Cell, type Point } from "./geometry";
import type { GridModel } from "./model";
import type { CentreRef } from "./select";
import { createPainter, paintStamp, type Stamp } from "./stamp";
import type { GridShape, GridSize } from "./settings";
import {
  applyCell,
  applyElement,
  applyPoint,
  cellPoint6,
  compose,
  cornerPoint6,
  edgeMidpoint6,
  IDENTITY,
  invert,
  isometryKey,
  reflectionAbout,
  rotationAbout,
  translation,
  type Axial,
  type ElementRef,
  type Isometry,
} from "./transform";

/**
 * Wallpaper groups on the hex grid: the 14 subgroups of p6m (everything but
 * the square-lattice groups p4, p4g, p4m). A group is described by a name, the
 * lattice vector(s) and a centre; `generators` turns that into concrete
 * isometries and `closure` enumerates the group within a bounded window.
 */
export type GroupName =
  | "p1"
  | "p2"
  | "p3"
  | "p3m1"
  | "p31m"
  | "p6"
  | "p6m"
  | "pm"
  | "pg"
  | "cm"
  | "pmm"
  | "pmg"
  | "pgg"
  | "cmm";

export const GROUP_NAMES: readonly GroupName[] = [
  "p1",
  "p2",
  "p3",
  "p3m1",
  "p31m",
  "p6",
  "p6m",
  "pm",
  "pg",
  "cm",
  "pmm",
  "pmg",
  "pgg",
  "cmm",
];

/** which lattice inputs a group needs in the UI */
export function latticeKind(name: GroupName): "hexagonal" | "oblique" | "rectangular" | "rhombic" {
  if (name === "p1" || name === "p2") return "oblique";
  if (name === "pm" || name === "pg" || name === "pmm" || name === "pmg" || name === "pgg") return "rectangular";
  if (name === "cm" || name === "cmm") return "rhombic";
  return "hexagonal";
}

/** the centre types a group's point operations allow (for double-click snapping) */
export function allowedCentreTypes(name: GroupName): readonly CentreRef["type"][] {
  switch (name) {
    case "p1":
      return ["cell", "vertex", "edge"]; // irrelevant, anything goes
    case "p2":
      return ["cell", "edge"];
    case "p3":
      return ["cell", "vertex"];
    case "p6":
    case "p6m":
      return ["cell"];
    case "p3m1":
    case "p31m":
      return ["cell", "vertex"];
    default:
      return ["cell", "vertex", "edge"]; // mirrors/glides exist through all three
  }
}

export type GroupSpec = { name: GroupName; u: Axial; v: Axial; centre: CentreRef };

export function centrePoint6(centre: CentreRef): Axial {
  const cell = { col: centre.col, row: centre.row };
  if (centre.type === "cell") return cellPoint6(cell);
  if (centre.type === "vertex") return cornerPoint6(cell, centre.k);
  return edgeMidpoint6(cell, centre.k);
}

// ---- exact linear helpers in axial coordinates

function rot60(p: Axial): Axial {
  return { q: -p.r, r: p.q + p.r };
}

function pixel(p: Axial): Point {
  return { x: 1.5 * p.q, y: Math.sqrt(3) * (p.r + p.q / 2) };
}

function linear(iso: Isometry, p: Axial): Axial {
  return { q: iso.a * p.q + iso.b * p.r, r: iso.c * p.q + iso.d * p.r };
}

/** does the lattice ⟨u, v⟩ contain w? (integer 2×2 solve) */
export function latticeContains(u: Axial, v: Axial, w: Axial): boolean {
  const det = u.q * v.r - u.r * v.q;
  if (det === 0) return false;
  const a = w.q * v.r - w.r * v.q;
  const b = u.q * w.r - u.r * w.q;
  return a % det === 0 && b % det === 0;
}

function isZero(p: Axial): boolean {
  return p.q === 0 && p.r === 0;
}

/** the mirror-axis direction (0..5) exactly parallel to w, or null */
function axisAlong(w: Axial): number | null {
  for (let d = 0; d < 6; d++) {
    const m = reflectionAbout({ q: 0, r: 0 }, d);
    const image = linear(m, w);
    if (image.q === w.q && image.r === w.r) return d;
  }
  return null;
}

/**
 * A glide along `u` whose axis runs through `about6`: linear part = mirror
 * with axis ∥ u, translation t solving (I + M)·t = u, so that g² = T(u).
 */
export function glideAlong(about6: Axial, u: Axial): Isometry {
  const d = axisAlong(u);
  if (d === null) throw new Error("glide direction must run along a grid axis");
  const mirror = reflectionAbout(about6, d);
  const m = { a: mirror.a, b: mirror.b, c: mirror.c, d: mirror.d };
  const limit = Math.max(Math.abs(u.q), Math.abs(u.r)) + 2;
  for (let tq = -limit; tq <= limit; tq++) {
    for (let tr = -limit; tr <= limit; tr++) {
      const mt = linear({ ...m, tq: 0, tr: 0 }, { q: tq, r: tr });
      if (tq + mt.q === u.q && tr + mt.r === u.r) {
        return compose(translation(tq, tr), mirror);
      }
    }
  }
  throw new Error("no lattice glide exists for this direction — halve or re-align u");
}

/** concrete generators for a group; throws with a readable message when the spec is invalid */
export function generators(spec: GroupSpec): Isometry[] {
  const { name, centre } = spec;
  const u = spec.u;
  if (isZero(u)) throw new Error("u must be non-zero");
  const c6 = centrePoint6(centre);
  const hexagonalV = rot60(u);
  const v = latticeKind(name) === "hexagonal" ? hexagonalV : spec.v;
  if (isZero(v) || u.q * v.r - u.r * v.q === 0) throw new Error("u and v must be linearly independent");
  const t = [translation(u.q, u.r), translation(v.q, v.r)];

  function checked(gens: Isometry[]): Isometry[] {
    for (const g of gens) {
      if (g.a === 1 && g.b === 0 && g.c === 0 && g.d === 1) continue;
      if (!latticeContains(u, v, linear(g, u)) || !latticeContains(u, v, linear(g, v))) {
        throw new Error("the lattice ⟨u, v⟩ is not preserved by the group's point operations — re-align u/v");
      }
    }
    return gens;
  }

  function axisOf(w: Axial, what: string): number {
    const d = axisAlong(w);
    if (d === null) throw new Error(`${what} must run along a grid axis (multiples of 30°)`);
    return d;
  }

  function perpendicular(): void {
    const pu = pixel(u);
    const pv = pixel(v);
    if (Math.abs(pu.x * pv.x + pu.y * pv.y) > 1e-9) throw new Error("u and v must be perpendicular for this group");
  }

  switch (name) {
    case "p1":
      return t;
    case "p2":
      return checked([...t, rotationAbout(c6, 3)]);
    case "p3":
      return checked([...t, rotationAbout(c6, 2)]);
    case "p6":
      return checked([...t, rotationAbout(c6, 1)]);
    case "p3m1":
      // mirrors at 30° to u (through the edge-midpoint directions of the u-frame)
      return checked([...t, rotationAbout(c6, 2), reflectionAbout(c6, (axisOf(u, "u") + 1) % 6)]);
    case "p31m":
      // mirrors along u
      return checked([...t, rotationAbout(c6, 2), reflectionAbout(c6, axisOf(u, "u"))]);
    case "p6m":
      return checked([...t, rotationAbout(c6, 1), reflectionAbout(c6, axisOf(u, "u"))]);
    case "pm":
      perpendicular();
      return checked([...t, reflectionAbout(c6, axisOf(u, "u"))]);
    case "pg":
      perpendicular();
      return checked([...t, glideAlong(c6, u)]);
    case "cm": {
      // rhombic: v must be the mirror image of u; the axis bisects them (∥ u+v)
      const axis = axisOf({ q: u.q + v.q, r: u.r + v.r }, "u+v");
      const mirror = reflectionAbout(c6, axis);
      const image = linear(mirror, u);
      if (image.q !== v.q || image.r !== v.r) throw new Error("for cm/cmm, v must be the mirror image of u (|u| = |v|)");
      return checked([...t, mirror]);
    }
    case "pmm":
      perpendicular();
      return checked([...t, reflectionAbout(c6, axisOf(u, "u")), reflectionAbout(c6, axisOf(v, "v"))]);
    case "pmg":
      // mirrors across v, glides along u
      perpendicular();
      return checked([...t, reflectionAbout(c6, axisOf(v, "v")), glideAlong(c6, u)]);
    case "pgg":
      perpendicular();
      return checked([...t, glideAlong(c6, u), glideAlong(c6, v)]);
    case "cmm": {
      const axis = axisOf({ q: u.q + v.q, r: u.r + v.r }, "u+v");
      const mirror = reflectionAbout(c6, axis);
      const image = linear(mirror, u);
      if (image.q !== v.q || image.r !== v.r) throw new Error("for cm/cmm, v must be the mirror image of u (|u| = |v|)");
      return checked([...t, mirror, rotationAbout(c6, 3)]);
    }
  }
}

const CLOSURE_CAP = 50000;

/**
 * All group elements whose image of `ref` stays within `radius` (pixel units
 * of the side-1 lattice) of `ref`, by BFS over generator products. A margin of
 * one generator step keeps the enumeration connected.
 */
export function closure(gens: readonly Isometry[], ref: Point, radius: number): Isometry[] {
  const steps = [...gens, ...gens.map(invert)];
  const margin = Math.max(1, ...steps.map((g) => distance(applyPoint(g, ref), ref)));
  const bound = radius + 2 * margin;
  const seen = new Map<string, Isometry>([[isometryKey(IDENTITY), IDENTITY]]);
  const queue: Isometry[] = [IDENTITY];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const step of steps) {
      const next = compose(step, current);
      const key = isometryKey(next);
      if (seen.has(key)) continue;
      if (distance(applyPoint(next, ref), ref) > bound) continue;
      if (seen.size >= CLOSURE_CAP) throw new Error("symmetry group enumeration exceeded its cap");
      seen.set(key, next);
      queue.push(next);
    }
  }
  return [...seen.values()];
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function gridRef(grid: GridShape): { ref: Point; radius: number } {
  const unit: GridShape = { ...grid, side: 1, orientationDeg: 0 };
  const a = cellCenter(unit, 0, 0);
  const b = cellCenter(unit, grid.columns - 1, grid.rows - 1);
  const ref = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return { ref, radius: distance(ref, a) + 2 };
}

/** the group elements relevant for a grid window */
export function gridClosure(spec: GroupSpec, grid: GridSize): Isometry[] {
  const shape: GridShape = { columns: grid.columns, rows: grid.rows, side: 1, orientationDeg: 0 };
  const { ref, radius } = gridRef(shape);
  return closure(generators(spec), ref, 2 * radius);
}

export type CellOrbits = { orbitCount: number; orbitOf: Int32Array };

/** partition of the grid's cells into group orbits */
export function cellOrbits(spec: GroupSpec, grid: GridSize): CellOrbits {
  const group = gridClosure(spec, grid);
  const cells = grid.columns * grid.rows;
  const parent = new Int32Array(cells).map((_, i) => i);
  function find(i: number): number {
    let root = i;
    while (parent[root] !== root) root = parent[root] ?? root;
    while (parent[i] !== root) {
      const next = parent[i] ?? root;
      parent[i] = root;
      i = next;
    }
    return root;
  }
  function union(a: number, b: number) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }
  for (let col = 0; col < grid.columns; col++) {
    for (let row = 0; row < grid.rows; row++) {
      for (const g of group) {
        const image = applyCell(g, { col, row });
        if (inGrid(grid, image.col, image.row)) {
          union(row * grid.columns + col, image.row * grid.columns + image.col);
        }
      }
    }
  }
  const orbitOf = new Int32Array(cells);
  const roots = new Map<number, number>();
  for (let i = 0; i < cells; i++) {
    const root = find(i);
    let id = roots.get(root);
    if (id === undefined) {
      id = roots.size;
      roots.set(root, id);
    }
    orbitOf[i] = id;
  }
  return { orbitCount: roots.size, orbitOf };
}

/**
 * A compact fundamental cell set: BFS outward from `from`, keeping the first
 * cell of every orbit.
 */
export function suggestDomain(spec: GroupSpec, grid: GridSize, from: Cell): Cell[] {
  const { orbitCount, orbitOf } = cellOrbits(spec, grid);
  const seen = new Set<number>();
  const chosen: Cell[] = [];
  const visited = new Set<number>();
  const queue: Cell[] = [from];
  visited.add(from.row * grid.columns + from.col);
  while (queue.length > 0 && chosen.length < orbitCount) {
    const cell = queue.shift();
    if (cell === undefined) break;
    const index = cell.row * grid.columns + cell.col;
    const orbit = orbitOf[index] ?? 0;
    if (!seen.has(orbit)) {
      seen.add(orbit);
      chosen.push(cell);
    }
    for (let k = 0; k < 6; k++) {
      const a = cellToAxial(cell);
      const step = [
        { q: 1, r: 0 },
        { q: 0, r: 1 },
        { q: -1, r: 1 },
        { q: -1, r: 0 },
        { q: 0, r: -1 },
        { q: 1, r: -1 },
      ][k];
      if (step === undefined) continue;
      const n = { q: a.q + step.q, r: a.r + step.r };
      const next = { col: n.q, row: n.r + (n.q - (n.q & 1)) / 2 };
      const ni = next.row * grid.columns + next.col;
      if (!inGrid(grid, next.col, next.row) || visited.has(ni)) continue;
      visited.add(ni);
      queue.push(next);
    }
  }
  return chosen;
}

export type TilingResult = { model: GridModel; conflicts: number; gaps: number; copies: number };

/**
 * Tile the whole grid: the stamp (anchored at `anchor`) is repeated under the
 * group; the first copy of every element wins, later differing copies count
 * as conflicts. Gaps are grid cells no copy reaches.
 */
export function tileGrid(model: GridModel, stamp: Stamp, spec: GroupSpec, anchor: Cell): TilingResult {
  const a = cellToAxial(anchor);
  const embed = translation(a.q, a.r);
  const group = gridClosure(spec, model);
  const painter = createPainter(model);
  for (const g of group) paintStamp(painter, stamp, compose(g, embed), "first-wins");
  const { model: tiled, conflicts } = painter.finish();
  // gaps: cells no copy of the stamp's cell set reached
  const touched = new Set<number>();
  for (const g of group) {
    for (const sc of stamp.cells) {
      const virtual = { q: sc.dq, r: sc.dr };
      const cell = applyCell(compose(g, embed), { col: virtual.q, row: virtual.r + (virtual.q - (virtual.q & 1)) / 2 });
      if (inGrid(model, cell.col, cell.row)) touched.add(cell.row * model.columns + cell.col);
    }
  }
  return { model: tiled, conflicts, gaps: model.columns * model.rows - touched.size, copies: group.length };
}

/**
 * The orbit of one element among the elements the `keep` predicate admits
 * (symmetric editing in the stamp editor: an edit applies to the whole class).
 */
export function elementOrbit(
  gens: readonly Isometry[],
  el: ElementRef,
  keep: (el: ElementRef) => boolean,
  ref: Point,
  radius: number,
): ElementRef[] {
  const group = closure(gens, ref, radius);
  const seen = new Map<string, ElementRef>();
  for (const g of group) {
    const image = applyElement(g, el);
    if (!keep(image)) continue;
    seen.set(`${image.kind}:${image.col},${image.row},${image.k}`, image);
  }
  return [...seen.values()];
}

/** fixed point of a rotation g (rational solve of (I−M)x = t), or null for translations */
export function rotationFixedPoint(g: Isometry): Point | null {
  const a = 1 - g.a;
  const b = -g.b;
  const c = -g.c;
  const d = 1 - g.d;
  const det = a * d - b * c;
  if (det === 0) return null;
  const q = (g.tq * d - g.tr * b) / det;
  const r = (g.tr * a - g.tq * c) / det;
  return pixel({ q, r });
}

/** is p fixed by g? (points on a reflection's axis are) */
export function isFixedBy(g: Isometry, p: Point): boolean {
  return distance(applyPoint(g, p), p) < 1e-6;
}

/** true when g is orientation-reversing with no glide component (a pure mirror) */
export function isPureMirror(g: Isometry): boolean {
  if (g.a * g.d - g.b * g.c !== -1) return false;
  // glide vector = ½(t + M t); pure mirror ⇔ zero
  const mt = linear(g, { q: g.tq, r: g.tr });
  return g.tq + mt.q === 0 && g.tr + mt.r === 0;
}

/** order-3 rotation? (det 1, trace = −1 for ±120°) */
export function isOrder3Rotation(g: Isometry): boolean {
  return g.a * g.d - g.b * g.c === 1 && g.a + g.d === -1;
}


