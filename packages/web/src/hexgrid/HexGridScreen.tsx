import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Point } from "./geometry";
import { parseDocument, serializeDocument, type GridDocument } from "./file";
import { cellAt, cellToAxial, toLocal, type Cell } from "./geometry";
import { canRedo, canUndo, emptyHistory, pushHistory, redoHistory, undoHistory, type History } from "./history";
import {
  cellPolygonPath,
  centrePoint,
  elementTouchesMember,
  fromStampCentre,
  nearestCentre,
  toStampCentre,
  type CentreRef,
} from "./select";
import { applyStamp, captureStamp, stampGhostPaths, stampToDocumentModel, type StoredStamp } from "./stamp";
import {
  allowedCentreTypes,
  cellOrbits,
  elementOrbit,
  generators,
  GROUP_NAMES,
  latticeKind,
  suggestDomain,
  tileGrid,
  type GroupName,
  type GroupSpec,
  type TilingResult,
} from "./symmetry";
import { StampPanel } from "./StampPanel";
import { memoryStampStore, openStampStore, type StampStore } from "./stamps-db";
import { applyCell, compose, IDENTITY, reflectionAbout, rotationAbout, translation, type Isometry } from "./transform";
import { hitElement, type ElementHit } from "./hit";
import {
  ALL_LINES,
  ALL_VERTICES,
  CENTRE,
  clampTriangles,
  clearTriangles,
  createModel,
  cycleTriangle,
  fillLines,
  fillVertices,
  hasElement,
  resizeModel,
  setTriangleState,
  toggleElement,
  triangleState,
  type GridModel,
} from "./model";
import { clampSetting, DEFAULT_SETTINGS, LIMITS, type GridSettings, type NumericSetting } from "./settings";
import { cellIndex } from "./model";
import { cellCenter, cellVertex, toWorld } from "./geometry";
import {
  documentBounds,
  FILL_SEAM_STROKE,
  fmt,
  pathBands,
  stateColor,
  toSvgDocument,
  type PathBands,
  type PathKind,
} from "./svg";

/**
 * screen px = world mm · scale + (tx, ty). The view is applied through the
 * svg's viewBox, not a transform on a group: a transform that changes every
 * frame makes browsers cache the drawing as a bitmap and scale that (fuzzy
 * until they re-rasterise), while a viewBox change is a plain crisp repaint.
 */
type View = { scale: number; tx: number; ty: number };
type Size = { width: number; height: number };

/** editing (default), selecting cells for a stamp, or placing a stamp */
type Mode =
  | { kind: "edit" }
  | { kind: "select"; cells: Set<number>; centre: CentreRef | null }
  | { kind: "place"; stamp: StoredStamp; rotation: number; mirror: boolean; merge: boolean };

const ORIGIN6 = { q: 0, r: 0 };

/** the point-group part of a placement: mirror first, then rotate */
function placementPointPart(rotation: number, mirror: boolean): Isometry {
  const m = mirror ? reflectionAbout(ORIGIN6, 0) : IDENTITY;
  return compose(rotationAbout(ORIGIN6, rotation), m);
}

function timestampName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const STORAGE_KEY = "hex-grid";
const HIT_TOLERANCE_PX = 8;
/** line tolerance is capped so triangles stay clickable when zoomed far out */
const LINE_HIT_MAX_SIDE_FRACTION = 0.2;
const VERTEX_HIT_PX = 6;
/** vertex hit radius is capped so lines stay clickable when zoomed far out */
const VERTEX_HIT_MAX_SIDE_FRACTION = 0.25;
const HOVER_LINE_MIN_PX = 1.5;
const HOVER_RING_MIN_PX = 12;
const HOVER_RING_MIN_STROKE_PX = 2;
const DRAG_THRESHOLD_PX = 3;
const MIN_SCALE = 0.05;
const MAX_SCALE = 400;
const AUTOSAVE_DELAY_MS = 300;
const BAND_ROWS = 8;

function freshDocument(): GridDocument {
  return { settings: DEFAULT_SETTINGS, model: createModel(DEFAULT_SETTINGS.columns, DEFAULT_SETTINGS.rows) };
}

function loadStoredDocument(): GridDocument {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (text !== null) return parseDocument(text);
  } catch {
    // corrupt or blocked storage: start fresh
  }
  return freshDocument();
}

function download(filename: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function HexGridScreen() {
  const [doc, setDoc] = useState<GridDocument>(loadStoredDocument);
  const [history, setHistory] = useState<History<GridModel>>(emptyHistory);
  const [view, setView] = useState<View>({ scale: 4, tx: 0, ty: 0 });
  const [hover, setHover] = useState<ElementHit | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fitted, setFitted] = useState(false);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [mode, setMode] = useState<Mode>({ kind: "edit" });
  const [stamps, setStamps] = useState<StoredStamp[]>([]);
  const [showStamps, setShowStamps] = useState(false);
  const [placeTarget, setPlaceTarget] = useState<Cell | null>(null);
  /** tiling panel state: spec inputs + whether to clear the grid first */
  const [tiling, setTiling] = useState<{
    stamp: StoredStamp;
    name: GroupName;
    u: { q: number; r: number };
    v: { q: number; r: number };
    centre: CentreRef;
    clearFirst: boolean;
    showDomain: boolean;
  } | null>(null);
  /** editing a stamp: the main document is stashed and swapped for the stamp's sub-document */
  const [stampEdit, setStampEdit] = useState<{
    source: StoredStamp;
    members: Set<number>;
    centre: CentreRef | null;
    stash: { doc: GridDocument; history: History<GridModel> };
  } | null>(null);
  const stampStore = useRef<StampStore>(memoryStampStore());
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const bandCache = useRef(new Map<string, PathBands>());

  const { settings, model } = doc;

  /** every model change goes through here so it lands in the undo history */
  function changeModel(change: (d: GridDocument) => GridDocument) {
    setDoc((d) => {
      const next = change(d);
      if (next.model !== d.model) setHistory((h) => pushHistory(h, d.model));
      return next;
    });
  }

  /** restore a model snapshot; the grid dimensions travel with it, other settings stay */
  function restore(step: (h: History<GridModel>, present: GridModel) => { restored: GridModel; history: History<GridModel> } | null) {
    const result = step(history, doc.model);
    if (result === null) return;
    setHistory(result.history);
    const m = clampTriangles(result.restored, doc.settings.stateCount);
    setDoc((d) => ({ settings: { ...d.settings, columns: m.columns, rows: m.rows }, model: m }));
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.target instanceof HTMLInputElement) return;
      if (event.key === "z" && !event.shiftKey) {
        event.preventDefault();
        restore(undoHistory);
      } else if (event.key === "y" || (event.key === "z" && event.shiftKey) || event.key === "Z") {
        event.preventDefault();
        restore(redoHistory);
      }
    }
    function onModeKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "Escape") setMode((m) => (m.kind === "place" ? { kind: "edit" } : m));
      setMode((m) => {
        if (m.kind !== "place") return m;
        if (event.key === "r" || event.key === "R") return { ...m, rotation: (m.rotation + 1) % 6 };
        if (event.key === "f" || event.key === "F") return { ...m, mirror: !m.mirror };
        return m;
      });
    }
    window.addEventListener("keydown", onModeKey);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keydown", onModeKey);
    };
  });
  const { columns, rows, side, orientationDeg, outlineWidth, spokeWidth, vertexDiameter, stateCount } = settings;
  const shapeDeps = [columns, rows, side, orientationDeg];

  // path strings are rebuilt only when the geometry or the elements change — never on pan/zoom
  function bandedPaths(key: string, what: PathKind, shown: GridModel): string[] {
    const bands = pathBands(what, settings, shown, BAND_ROWS, bandCache.current.get(key));
    bandCache.current.set(key, bands);
    return bands.paths;
  }
  const bounds = useMemo(
    () => documentBounds(settings),
    [...shapeDeps, outlineWidth, spokeWidth, vertexDiameter],
  );

  /** live tiling preview (and its diagnostics); errors surface in the panel */
  const tilingPreview = useMemo(() => {
    if (tiling === null) return null;
    const spec: GroupSpec = { name: tiling.name, u: tiling.u, v: tiling.v, centre: tiling.centre };
    try {
      const base = tiling.clearFirst
        ? createModel(columns, rows, 0, 0, 0)
        : model;
      const baseCleared = tiling.clearFirst ? { ...base, edges: new Uint8Array(base.edges).fill(0) } : base;
      const result = tileGrid(baseCleared, tiling.stamp.stamp, spec, tilingAnchor());
      const domain = tiling.showDomain ? suggestDomain(spec, model, tilingAnchor()) : [];
      const orbits = cellOrbits(spec, model).orbitCount;
      return { result, domain, orbits, error: null as string | null };
    } catch (err) {
      return { result: null as TilingResult | null, domain: [] as Cell[], orbits: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }, [tiling, ...shapeDeps, model]);

  /** while the tiling panel is open, the canvas shows the preview */
  const shownModel = tiling !== null && tilingPreview?.result != null ? tilingPreview.result.model : model;
  const outlinePaths = useMemo(() => bandedPaths("edge", { kind: "edge" }, shownModel), [...shapeDeps, shownModel]);
  const spokePaths = useMemo(() => bandedPaths("spoke", { kind: "spoke" }, shownModel), [...shapeDeps, shownModel]);
  const vertexPaths = useMemo(
    () => bandedPaths("vertex", { kind: "vertex" }, shownModel),
    [...shapeDeps, vertexDiameter, shownModel],
  );
  const fillPaths = useMemo(
    () =>
      Array.from({ length: stateCount - 1 }, (_, i) => {
        const state = i + 1;
        return { state, paths: bandedPaths(`triangle:${state}`, { kind: "triangle", state }, shownModel) };
      }),
    [...shapeDeps, stateCount, shownModel],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, serializeDocument(doc));
      } catch {
        // storage full or blocked: the explicit JSON download still works
      }
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [doc]);

  useEffect(() => {
    let cancelled = false;
    openStampStore()
      .then(async (store) => {
        const all = await store.all();
        if (cancelled) return;
        stampStore.current = store;
        setStamps(all);
      })
      .catch(() => undefined); // no IndexedDB: the in-memory fallback stays
    return () => {
      cancelled = true;
    };
  }, []);

  // the viewBox needs the svg's pixel size; observing it also keeps the
  // mapping exact when the panel is resized
  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  function fitView() {
    const { width, height } = size;
    if (width === 0 || height === 0) return;
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, 0.92 * Math.min(width / w, height / h)));
    setView({
      scale,
      tx: (width - w * scale) / 2 - bounds.minX * scale,
      ty: (height - h * scale) / 2 - bounds.minY * scale,
    });
  }

  useEffect(() => {
    if (fitted || size.width === 0) return;
    fitView();
    setFitted(true);
  }, [fitted, size]);

  // wheel listeners must be non-passive to keep the page from scrolling
  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const p = localPointer(svg, event);
      const factor = Math.exp(-event.deltaY * 0.0015);
      setView((v) => {
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
        const ratio = scale / v.scale;
        return { scale, tx: p.x - (p.x - v.tx) * ratio, ty: p.y - (p.y - v.ty) * ratio };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  function updateSettings(patch: Partial<GridSettings>) {
    // the stamp editor's membership is indexed by cell — freeze the dimensions there
    if (stampEdit !== null && (patch.columns !== undefined || patch.rows !== undefined)) return;
    changeModel((d) => {
      const next = { ...d.settings, ...patch };
      const model = clampTriangles(resizeModel(d.model, next.columns, next.rows), next.stateCount);
      return { settings: next, model };
    });
  }

  function setStateColor(state: number, color: string) {
    setDoc((d) => {
      const stateColors = [...d.settings.stateColors];
      stateColors[state - 1] = color;
      return { ...d, settings: { ...d.settings, stateColors } };
    });
  }

  function setLines(spokes: number, edges: number) {
    changeModel((d) => ({ ...d, model: fillLines(d.model, spokes, edges) }));
  }

  function setVertices(bits: number) {
    changeModel((d) => ({ ...d, model: fillVertices(d.model, bits) }));
  }

  function clearFills() {
    changeModel((d) => ({ ...d, model: clearTriangles(d.model) }));
  }

  function clearAll() {
    changeModel((d) => ({ ...d, model: clearTriangles(fillVertices(fillLines(d.model, 0, 0), 0)) }));
  }

  function startTiling(stamp: StoredStamp) {
    if (stampEdit !== null) return;
    const anchor = tilingAnchor();
    const centre =
      stamp.stamp.centre !== undefined
        ? fromStampCentre(stamp.stamp.centre, anchor)
        : { type: "cell" as const, col: anchor.col, row: anchor.row, k: 0 };
    const sym = stamp.symmetry;
    const name = sym !== undefined && (GROUP_NAMES as readonly string[]).includes(sym.name) ? (sym.name as GroupName) : "p6";
    setTiling({
      stamp,
      name,
      u: sym?.u ?? { q: 1, r: 0 },
      v: sym?.v ?? { q: -1, r: 2 },
      centre,
      clearFirst: true,
      showDomain: false,
    });
    setMode({ kind: "edit" });
  }

  /** the stamp anchor used for tiling: the cell nearest the grid centre */
  function tilingAnchor(): Cell {
    return { col: Math.floor(columns / 2), row: Math.floor(rows / 2) };
  }

  function applyTiling() {
    if (tiling === null || tilingPreview?.result == null || tilingPreview.error !== null) return;
    const tiled = tilingPreview.result.model;
    changeModel((d) => ({ ...d, model: clampTriangles(tiled, d.settings.stateCount) }));
    persistStamp({
      ...tiling.stamp,
      modifiedAt: Date.now(),
      symmetry: { name: tiling.name, u: tiling.u, v: tiling.v },
      stamp: { ...tiling.stamp.stamp, centre: toStampCentre(tiling.centre, tilingAnchor()) },
    });
    setTiling(null);
  }

  function startEditingStamp(source: StoredStamp) {
    if (stampEdit !== null) return;
    const { model: sub, members, embed } = stampToDocumentModel(source.stamp);
    const anchor = applyCell(embed, { col: 0, row: 0 });
    const centre = source.stamp.centre === undefined ? null : fromStampCentre(source.stamp.centre, anchor);
    setStampEdit({ source, members, centre, stash: { doc, history } });
    setMode({ kind: "edit" });
    setDoc({ settings: { ...settings, columns: sub.columns, rows: sub.rows }, model: sub });
    setHistory(emptyHistory());
    setFitted(false);
  }

  function leaveStampEdit(save: boolean) {
    if (stampEdit === null) return;
    if (save && stampEdit.members.size > 0) {
      const cells = [...stampEdit.members].map((i) => ({ col: i % model.columns, row: Math.floor(i / model.columns) }));
      const anchor = cells.reduce((a, b) => (b.row < a.row || (b.row === a.row && b.col < a.col) ? b : a));
      const centre = stampEdit.centre === null ? undefined : toStampCentre(stampEdit.centre, anchor);
      persistStamp({
        ...stampEdit.source,
        modifiedAt: Date.now(),
        stamp: captureStamp(model, cells, anchor, centre),
      });
    }
    setStampEdit(null);
    setMode({ kind: "edit" });
    setDoc(stampEdit.stash.doc);
    setHistory(stampEdit.stash.history);
    setFitted(false);
  }

  function persistStamp(stamp: StoredStamp) {
    setStamps((all) => [...all.filter((s) => s.id !== stamp.id), stamp]);
    stampStore.current.put(stamp).catch(() => setError("Could not save the stamp library"));
  }

  function saveSelectionAsStamp() {
    if (mode.kind !== "select" || mode.cells.size === 0) return;
    const cells = [...mode.cells].map((i) => ({ col: i % columns, row: Math.floor(i / columns) }));
    const anchor = cells.reduce((a, b) => (b.row < a.row || (b.row === a.row && b.col < a.col) ? b : a));
    const centre = mode.centre === null ? undefined : toStampCentre(mode.centre, anchor);
    const now = Date.now();
    persistStamp({
      id: crypto.randomUUID(),
      name: timestampName(),
      createdAt: now,
      modifiedAt: now,
      stamp: captureStamp(model, cells, anchor, centre),
    });
    setShowStamps(true);
  }

  function renameStamp(id: string, name: string) {
    const stamp = stamps.find((s) => s.id === id);
    if (stamp === undefined || name.trim() === "") return;
    persistStamp({ ...stamp, name: name.trim(), modifiedAt: Date.now() });
  }

  function duplicateStamp(stamp: StoredStamp) {
    const now = Date.now();
    persistStamp({ ...stamp, id: crypto.randomUUID(), name: `${stamp.name} copy`, createdAt: now, modifiedAt: now });
  }

  function deleteStamp(id: string) {
    setStamps((all) => all.filter((s) => s.id !== id));
    setMode((m) => (m.kind === "place" && m.stamp.id === id ? { kind: "edit" } : m));
    stampStore.current.remove(id).catch(() => setError("Could not update the stamp library"));
  }

  function importStamps(imported: StoredStamp[]) {
    for (const stamp of imported) persistStamp(stamp);
    setError(null);
  }

  function startPlacing(stamp: StoredStamp) {
    setMode({ kind: "place", stamp, rotation: 0, mirror: false, merge: false });
  }

  function cellAtPointer(p: Point): Cell | null {
    return cellAt(settings, toLocal(settings, toWorldPoint(p)));
  }

  function placeAt(target: Cell) {
    if (mode.kind !== "place") return;
    const a = cellToAxial(target);
    const iso = compose(translation(a.q, a.r), placementPointPart(mode.rotation, mode.mirror));
    changeModel((d) => ({
      ...d,
      model: clampTriangles(applyStamp(d.model, mode.stamp.stamp, iso, mode.merge ? "merge" : "replace"), d.settings.stateCount),
    }));
  }

  function toWorldPoint(p: Point): Point {
    return { x: (p.x - view.tx) / view.scale, y: (p.y - view.ty) / view.scale };
  }

  function hitAt(p: Point): ElementHit | null {
    const lineTolerance = Math.min(LINE_HIT_MAX_SIDE_FRACTION * side, HIT_TOLERANCE_PX / view.scale);
    const vertexRadius = Math.min(
      VERTEX_HIT_MAX_SIDE_FRACTION * side,
      Math.max(vertexDiameter / 2, VERTEX_HIT_PX / view.scale),
    );
    return hitElement(settings, toWorldPoint(p), lineTolerance, vertexRadius);
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    const svg = event.currentTarget as SVGSVGElement;
    svg.setPointerCapture(event.pointerId);
    const p = localPointer(svg, event);
    drag.current = { x: p.x, y: p.y, tx: view.tx, ty: view.ty, moved: false };
  }

  function onPointerMove(event: PointerEvent) {
    const p = localPointer(event.currentTarget as SVGSVGElement, event);
    const d = drag.current;
    if (d === null) {
      if (mode.kind === "edit" && tiling === null) setHover(hitAt(p));
      else setHover(null);
      if (mode.kind === "place") setPlaceTarget(cellAtPointer(p));
      return;
    }
    const dx = p.x - d.x;
    const dy = p.y - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
      setHover(null);
    }
    setView((v) => ({ ...v, tx: d.tx + dx, ty: d.ty + dy }));
  }

  function onPointerUp(event: PointerEvent) {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (d === null) return;
    const svg = event.currentTarget as SVGSVGElement;
    svg.releasePointerCapture(event.pointerId);
    if (d.moved) return;
    const p = localPointer(svg, event);
    if (mode.kind === "select") {
      const cell = cellAtPointer(p);
      if (cell === null) return;
      const index = cellIndex(model, cell.col, cell.row);
      setMode((m) => {
        if (m.kind !== "select") return m;
        const cells = new Set(m.cells);
        if (cells.has(index)) cells.delete(index);
        else cells.add(index);
        return { ...m, cells };
      });
      return;
    }
    if (mode.kind === "place") {
      const cell = cellAtPointer(p);
      if (cell !== null) placeAt(cell);
      return;
    }
    if (tiling !== null) return; // the canvas shows a preview — no editing
    const hit = hitAt(p);
    if (hit === null) return;
    if (
      stampEdit !== null &&
      !elementTouchesMember(model, hit, (cell) => stampEdit.members.has(cellIndex(model, cell.col, cell.row)))
    ) {
      return; // outside the stamp's cells
    }
    if (stampEdit !== null && stampEdit.source.symmetry !== undefined) {
      const expanded = symmetricHits(stampEdit.source, model, stampEdit.members, hit);
      if (expanded !== null) {
        changeModel((current) => {
          let next = current.model;
          for (const h of expanded) next = applyClick({ ...current, model: next }, h, event.shiftKey);
          return { ...current, model: next };
        });
        return;
      }
    }
    changeModel((current) => ({ ...current, model: applyClick(current, hit, event.shiftKey) }));
  }

  function onPointerLeave() {
    if (drag.current === null) setHover(null);
  }

  // a double-click's two pointerups toggle the cell twice (net no-op); the
  // dblclick event then only has to set the centre
  function onDoubleClick(event: MouseEvent) {
    const p = localPointer(event.currentTarget as SVGSVGElement, event);
    const centre = nearestCentre(settings, toWorldPoint(p));
    if (centre === null) return;
    if (mode.kind === "select") {
      setMode((m) => (m.kind === "select" ? { ...m, centre } : m));
      return;
    }
    if (tiling !== null) setTiling({ ...tiling, centre });
  }

  function exportSvg() {
    download("hex-grid.svg", "image/svg+xml", toSvgDocument(settings, model).svg);
  }

  function saveJson() {
    download("hex-grid.json", "application/json", serializeDocument(doc));
  }

  function loadJson(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file === undefined) return;
    file
      .text()
      .then((text) => {
        changeModel(() => parseDocument(text));
        setError(null);
        setFitted(false);
      })
      .catch((err: unknown) => setError(`Could not load file: ${err instanceof Error ? err.message : String(err)}`));
  }

  // the hovered element as it would be drawn, just dotted — in the background
  // colour when it is on (the solid shape visibly turns dotted), in its own
  // colour when it is off
  const hoverCue = hover === null || mode.kind !== "edit" ? null : hoverCueFor(settings, model, hover, view.scale);
  const selectionPath =
    mode.kind === "select"
      ? cellPolygonPath(
          settings,
          [...mode.cells].map((i) => ({ col: i % columns, row: Math.floor(i / columns) })),
        )
      : "";
  const centreMark =
    mode.kind === "select" && mode.centre !== null
      ? centrePoint(settings, mode.centre)
      : stampEdit !== null && mode.kind === "edit" && stampEdit.centre !== null
        ? centrePoint(settings, stampEdit.centre)
        : null;
  const domainPath =
    tiling !== null && tilingPreview !== null && tilingPreview.domain.length > 0
      ? cellPolygonPath(settings, tilingPreview.domain)
      : "";
  const dimPath =
    stampEdit === null || mode.kind === "select"
      ? ""
      : cellPolygonPath(
          settings,
          Array.from({ length: columns * rows }, (_, i) => ({ col: i % columns, row: Math.floor(i / columns) })).filter(
            (c) => !stampEdit.members.has(cellIndex(model, c.col, c.row)),
          ),
        );
  const ghost = useMemo(
    () => (mode.kind === "place" ? stampGhostPaths(mode.stamp.stamp, settings) : null),
    [mode.kind === "place" ? mode.stamp : null, settings],
  );
  const ghostTransform =
    mode.kind === "place" && ghost !== null && placeTarget !== null
      ? ghostMatrix(settings, ghost.anchor, placeTarget, mode.rotation, mode.mirror)
      : null;
  const viewportClass = `grid-viewport${dragging ? " dragging" : mode.kind === "select" ? " selecting" : hover !== null || mode.kind === "place" ? " hovering" : ""}`;
  const paperWidth = bounds.maxX - bounds.minX;
  const paperHeight = bounds.maxY - bounds.minY;
  const viewBox = `${-view.tx / view.scale} ${-view.ty / view.scale} ${Math.max(size.width, 1) / view.scale} ${Math.max(size.height, 1) / view.scale}`;

  return (
    <div class={showStamps ? "hexgrid with-stamps" : "hexgrid"}>
      <div class="card settings-panel">
        <h1>Hex grid</h1>
        <form onSubmit={(e) => e.preventDefault()}>
          <div class="fields">
            <NumberField label="Columns" name="columns" settings={settings} onChange={updateSettings} />
            <NumberField label="Rows" name="rows" settings={settings} onChange={updateSettings} />
            <NumberField label="Side length (mm)" name="side" settings={settings} onChange={updateSettings} />
            <NumberField label="Orientation (°)" name="orientationDeg" settings={settings} onChange={updateSettings} />
            <NumberField label="Outline width (mm)" name="outlineWidth" settings={settings} onChange={updateSettings} />
            <ColorField label="Outline colour" name="outlineColor" settings={settings} onChange={updateSettings} />
            <NumberField label="Triangle line width (mm)" name="spokeWidth" settings={settings} onChange={updateSettings} />
            <ColorField label="Triangle line colour" name="spokeColor" settings={settings} onChange={updateSettings} />
            <NumberField label="Vertex diameter (mm)" name="vertexDiameter" settings={settings} onChange={updateSettings} />
            <ColorField label="Vertex colour" name="vertexColor" settings={settings} onChange={updateSettings} />
            <NumberField label="Fill states" name="stateCount" settings={settings} onChange={updateSettings} />
          </div>
          <div class="fields">
            {Array.from({ length: stateCount - 1 }, (_, i) => i + 1).map((state) => (
              <label key={state}>
                State {state} colour
                <input
                  type="color"
                  value={stateColor(settings, state)}
                  onInput={(event) => setStateColor(state, event.currentTarget.value)}
                />
              </label>
            ))}
            <ColorField label="Background" name="backgroundColor" settings={settings} onChange={updateSettings} />
          </div>
          <div class="actions">
            <button type="button" onClick={() => setLines(0, ALL_LINES)}>
              Hex grid
            </button>
            <button type="button" onClick={() => setLines(ALL_LINES, ALL_LINES)}>
              Triangle grid
            </button>
            <button type="button" onClick={() => setVertices(ALL_VERTICES)}>
              All vertices
            </button>
            <button type="button" onClick={() => setVertices(0)}>
              No vertices
            </button>
            <button type="button" onClick={clearFills}>
              No fills
            </button>
            <button type="button" onClick={clearAll}>
              Clear
            </button>
            <button type="button" onClick={fitView}>
              Fit
            </button>
            <button type="button" onClick={() => restore(undoHistory)} disabled={!canUndo(history)}>
              Undo
            </button>
            <button type="button" onClick={() => restore(redoHistory)} disabled={!canRedo(history)}>
              Redo
            </button>
          </div>
          {stampEdit !== null && (
            <div class="actions stamp-edit-bar">
              <span class="hint">Editing “{stampEdit.source.name}”</span>
              <button type="button" onClick={() => leaveStampEdit(true)}>
                Save stamp
              </button>
              <button type="button" onClick={() => leaveStampEdit(false)}>
                Cancel
              </button>
            </div>
          )}
          <div class="actions">
            <button
              type="button"
              class={mode.kind === "select" ? "active" : ""}
              onClick={() =>
                setMode((m) => {
                  if (m.kind === "select") {
                    // leaving select mode while editing a stamp commits the membership
                    if (stampEdit !== null && m.cells.size > 0) {
                      setStampEdit((e) => (e === null ? e : { ...e, members: new Set(m.cells), centre: m.centre ?? e.centre }));
                    }
                    return { kind: "edit" };
                  }
                  return {
                    kind: "select",
                    cells: stampEdit === null ? new Set() : new Set(stampEdit.members),
                    centre: stampEdit?.centre ?? null,
                  };
                })
              }
            >
              {mode.kind === "select" ? (stampEdit === null ? "Done selecting" : "Apply cells") : stampEdit === null ? "Select cells" : "Edit cells"}
            </button>
            {mode.kind === "select" && (
              <>
                {stampEdit === null && (
                  <button type="button" onClick={saveSelectionAsStamp} disabled={mode.cells.size === 0}>
                    Save stamp
                  </button>
                )}
                <button type="button" onClick={() => setMode({ kind: "select", cells: new Set(), centre: null })}>
                  Clear selection
                </button>
              </>
            )}
            {mode.kind === "place" && (
              <>
                <label class="merge-toggle">
                  <input
                    type="checkbox"
                    checked={mode.merge}
                    onChange={(e) => setMode((m) => (m.kind === "place" ? { ...m, merge: e.currentTarget.checked } : m))}
                  />{" "}
                  merge
                </label>
                <button type="button" onClick={() => setMode({ kind: "edit" })}>
                  Stop placing
                </button>
              </>
            )}
            <button type="button" class={showStamps ? "active" : ""} onClick={() => setShowStamps((v) => !v)}>
              Stamps
            </button>
          </div>
          <div class="actions">
            <button type="button" onClick={exportSvg}>
              Download SVG
            </button>
            <button type="button" onClick={saveJson}>
              Save JSON
            </button>
            <label class="file-button">
              Load JSON
              <input type="file" accept=".json,application/json" onChange={loadJson} />
            </label>
          </div>
          {error !== null && <p class="error">{error}</p>}
          <p class="hint">
            Wheel zooms, left-drag pans, click a hex edge, a centre-to-corner line or a vertex to toggle it;
            click a triangle to step its fill state, shift-click to clear it. Sizes are millimetres; the SVG
            prints true to size.
          </p>
          <p class="grid-status">
            {mode.kind === "select"
              ? `${mode.cells.size} cells selected · double-click sets the centre`
              : mode.kind === "place"
                ? `placing “${mode.stamp.name}” · R rotates, F mirrors, Esc stops`
                : `${columns * rows} cells · ${fmt(paperWidth)} × ${fmt(paperHeight)} mm · zoom ${Math.round(view.scale * 100) / 100} px/mm`}
          </p>
        </form>
        {tiling !== null && (
          <div class="tiling-panel">
            <h2>Tile with “{tiling.stamp.name}”</h2>
            <label>
              Symmetry group
              <select
                value={tiling.name}
                onChange={(e) => setTiling({ ...tiling, name: e.currentTarget.value as GroupName })}
              >
                {GROUP_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <div class="fields">
              <label>
                u (q, r)
                <div class="vector-inputs">
                  <input
                    type="number"
                    step={1}
                    value={tiling.u.q}
                    onInput={(e) => vectorInput(e, (n) => setTiling({ ...tiling, u: { ...tiling.u, q: n } }))}
                  />
                  <input
                    type="number"
                    step={1}
                    value={tiling.u.r}
                    onInput={(e) => vectorInput(e, (n) => setTiling({ ...tiling, u: { ...tiling.u, r: n } }))}
                  />
                </div>
              </label>
              {latticeKind(tiling.name) !== "hexagonal" && (
                <label>
                  v (q, r)
                  <div class="vector-inputs">
                    <input
                      type="number"
                      step={1}
                      value={tiling.v.q}
                      onInput={(e) => vectorInput(e, (n) => setTiling({ ...tiling, v: { ...tiling.v, q: n } }))}
                    />
                    <input
                      type="number"
                      step={1}
                      value={tiling.v.r}
                      onInput={(e) => vectorInput(e, (n) => setTiling({ ...tiling, v: { ...tiling.v, r: n } }))}
                    />
                  </div>
                </label>
              )}
            </div>
            <p class="hint">
              Centre: {tiling.centre.type} at ({tiling.centre.col}, {tiling.centre.row}) — double-click the canvas to
              move it{allowedCentreTypes(tiling.name).length < 3 ? ` (${tiling.name} allows: ${allowedCentreTypes(tiling.name).join(", ")})` : ""}.
            </p>
            {tilingPreview?.error != null ? (
              <p class="error">{tilingPreview.error}</p>
            ) : tilingPreview?.result != null ? (
              <p class={tilingPreview.result.conflicts > 0 ? "error" : "grid-status"}>
                {tilingPreview.orbits} cell orbit{tilingPreview.orbits === 1 ? "" : "s"} · {tilingPreview.result.copies}{" "}
                copies · {tilingPreview.result.gaps} gaps ·{" "}
                {tilingPreview.result.conflicts > 0
                  ? `${tilingPreview.result.conflicts} conflicts — the first copy wins`
                  : "no conflicts"}
              </p>
            ) : null}
            <div class="actions">
              <label class="merge-toggle">
                <input
                  type="checkbox"
                  checked={tiling.clearFirst}
                  onChange={(e) => setTiling({ ...tiling, clearFirst: e.currentTarget.checked })}
                />{" "}
                clear grid first
              </label>
              <label class="merge-toggle">
                <input
                  type="checkbox"
                  checked={tiling.showDomain}
                  onChange={(e) => setTiling({ ...tiling, showDomain: e.currentTarget.checked })}
                />{" "}
                highlight domain
              </label>
            </div>
            <div class="actions">
              <button type="button" onClick={applyTiling} disabled={tilingPreview?.result == null}>
                Apply tiling
              </button>
              <button type="button" onClick={() => setTiling(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      <div class={viewportClass}>
        <svg
          ref={svgRef}
          viewBox={viewBox}
          preserveAspectRatio="none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
          onDblClick={onDoubleClick}
        >
          <rect
            x={bounds.minX}
            y={bounds.minY}
            width={paperWidth}
            height={paperHeight}
            fill={settings.backgroundColor}
          />
          {fillPaths.map(({ state, paths }) =>
            paths.map((d, band) => (
              <path
                key={`${state}/${band}`}
                d={d}
                fill={stateColor(settings, state)}
                stroke={stateColor(settings, state)}
                stroke-width={FILL_SEAM_STROKE}
                stroke-linejoin="round"
              />
            )),
          )}
          {spokePaths.map((d, band) => (
            <path
              key={band}
              d={d}
              fill="none"
              stroke={settings.spokeColor}
              stroke-width={spokeWidth}
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          ))}
          {outlinePaths.map((d, band) => (
            <path
              key={band}
              d={d}
              fill="none"
              stroke={settings.outlineColor}
              stroke-width={outlineWidth}
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          ))}
          {vertexPaths.map((d, band) => (
            <path key={band} d={d} fill={settings.vertexColor} />
          ))}
          {hoverCue?.kind === "line" && (
            // round caps on zero-length dashes give dots one width across, spaced
            // in multiples of the width, so the pattern looks the same at every zoom
            <line
              class="grid-hover"
              x1={hoverCue.a.x}
              y1={hoverCue.a.y}
              x2={hoverCue.b.x}
              y2={hoverCue.b.y}
              stroke={hoverCue.color}
              stroke-width={hoverCue.width}
              stroke-dasharray={`0 ${2.5 * hoverCue.width}`}
              stroke-linecap="round"
            />
          )}
          {hoverCue?.kind === "outline" && (
            <polygon
              class="grid-hover"
              points={hoverCue.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={hoverCue.color}
              stroke-width={hoverCue.width}
              stroke-dasharray={`0 ${2.5 * hoverCue.width}`}
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          )}
          {hoverCue?.kind === "ring" && (
            <circle
              class="grid-hover"
              cx={hoverCue.center.x}
              cy={hoverCue.center.y}
              r={hoverCue.radius}
              fill="none"
              stroke={hoverCue.color}
              stroke-width={hoverCue.width}
              stroke-dasharray={`0 ${2.5 * hoverCue.width}`}
              stroke-linecap="round"
            />
          )}
          {dimPath !== "" && <path class="grid-dim" d={dimPath} />}
          {domainPath !== "" && <path class="grid-selection" d={domainPath} />}
          {tiling !== null && <TilingCentreMark point={centrePoint(settings, tiling.centre)} scale={view.scale} />}
          {selectionPath !== "" && <path class="grid-selection" d={selectionPath} />}
          {centreMark !== null && (
            <g class="grid-centre" stroke-width={2 / view.scale}>
              <circle cx={centreMark.x} cy={centreMark.y} r={6 / view.scale} fill="none" />
              <circle cx={centreMark.x} cy={centreMark.y} r={1 / view.scale} />
            </g>
          )}
          {ghost !== null && ghostTransform !== null && (
            <g class="grid-ghost" transform={ghostTransform}>
              {ghost.fills.map(({ state, d }) => (
                <path key={state} d={d} fill={stateColor(settings, state)} stroke={stateColor(settings, state)} stroke-width={FILL_SEAM_STROKE} />
              ))}
              <path d={ghost.spokes} fill="none" stroke={settings.spokeColor} stroke-width={spokeWidth} stroke-linecap="round" />
              <path d={ghost.outline} fill="none" stroke={settings.outlineColor} stroke-width={outlineWidth} stroke-linecap="round" />
              <path d={ghost.dots} fill={settings.vertexColor} />
            </g>
          )}
        </svg>
      </div>
      {showStamps && (
        <StampPanel
          stamps={stamps}
          settings={settings}
          placingId={mode.kind === "place" ? mode.stamp.id : null}
          onRename={renameStamp}
          onPlace={startPlacing}
          onEdit={stampEdit === null ? startEditingStamp : null}
          onTile={stampEdit === null ? startTiling : null}
          onDuplicate={duplicateStamp}
          onDelete={deleteStamp}
          onImport={importStamps}
          onError={setError}
        />
      )}
    </div>
  );
}

/**
 * SVG matrix placing the stamp ghost: local frame → mirror/rotate about the
 * anchor → world rotation → the target cell's world position.
 */
function ghostMatrix(settings: GridSettings, anchor: Point, target: Cell, rotation: number, mirror: boolean): string {
  const angle = ((settings.orientationDeg + 60 * rotation) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // screen-CCW rotation in y-down coords: [cos sin; −sin cos]; mirror flips y first
  const my = mirror ? -1 : 1;
  const a = cos;
  const b = -sin;
  const c = sin * my;
  const d = cos * my;
  const t = toWorld(settings, cellCenter(settings, target.col, target.row));
  const e = t.x - (a * anchor.x + c * anchor.y);
  const f = t.y - (b * anchor.x + d * anchor.y);
  return `matrix(${a} ${b} ${c} ${d} ${e} ${f})`;
}

function vectorInput(event: Event, set: (n: number) => void) {
  const n = (event.currentTarget as HTMLInputElement).valueAsNumber;
  if (Number.isInteger(n)) set(n);
}

/** the orbit of the clicked element within the stamp's member cells */
function symmetricHits(
  source: StoredStamp,
  model: GridModel,
  members: Set<number>,
  hit: ElementHit,
): ElementHit[] | null {
  const sym = source.symmetry;
  if (sym === undefined || !(GROUP_NAMES as readonly string[]).includes(sym.name)) return null;
  // the sub-document's anchor is where the stamp's relative origin embedded;
  // recompute it the same way the editor did
  const { embed } = stampToDocumentModel(source.stamp);
  const anchorCell = applyCell(embed, { col: 0, row: 0 });
  const centreRef =
    source.stamp.centre !== undefined
      ? fromStampCentre(source.stamp.centre, anchorCell)
      : { type: "cell" as const, col: anchorCell.col, row: anchorCell.row, k: 0 };
  try {
    const gens = generators({ name: sym.name as GroupName, u: sym.u, v: sym.v, centre: centreRef });
    const keep = (el: { col: number; row: number }) =>
      el.col >= 0 && el.col < model.columns && el.row >= 0 && el.row < model.rows &&
      members.has(el.row * model.columns + el.col);
    const radius = 3 * (model.columns + model.rows);
    const orbit = elementOrbit(gens, hit, keep, { x: 0, y: 0 }, radius);
    return orbit.length === 0 ? [hit] : orbit.map((el) => ({ ...el }));
  } catch {
    return null;
  }
}

function TilingCentreMark({ point, scale }: { point: Point; scale: number }) {
  return (
    <g class="grid-centre" stroke-width={2 / scale}>
      <circle cx={point.x} cy={point.y} r={6 / scale} fill="none" />
      <circle cx={point.x} cy={point.y} r={1 / scale} />
    </g>
  );
}

function localPointer(svg: SVGSVGElement, event: { clientX: number; clientY: number }): Point {
  const rect = svg.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/** a left click steps a triangle's fill state (shift resets it) and toggles anything else */
function applyClick(doc: GridDocument, hit: ElementHit, shift: boolean): GridModel {
  const { model, settings } = doc;
  if (hit.kind !== "triangle") return toggleElement(model, hit.kind, hit.col, hit.row, hit.k);
  if (shift) return setTriangleState(model, hit.col, hit.row, hit.k, 0);
  return cycleTriangle(model, hit.col, hit.row, hit.k, settings.stateCount);
}

type HoverCue =
  | { kind: "line"; a: Point; b: Point; width: number; color: string }
  | { kind: "ring"; center: Point; radius: number; width: number; color: string }
  | { kind: "outline"; points: Point[]; width: number; color: string };

function hoverCueFor(settings: GridSettings, model: GridModel, hit: ElementHit, scale: number): HoverCue {
  const centre = cellCenter(settings, hit.col, hit.row);
  if (hit.kind === "triangle") {
    // the triangle's outline, inset so it does not sit on the lines, in the
    // colour the next click will give it (background = "clears it")
    const next = (triangleState(model, hit.col, hit.row, hit.k) + 1) % settings.stateCount;
    const width = Math.max(settings.spokeWidth, HOVER_LINE_MIN_PX / scale);
    const inset = Math.max(settings.outlineWidth, settings.spokeWidth) / 2 + width;
    const a = cellVertex(settings, hit.col, hit.row, hit.k);
    const b = cellVertex(settings, hit.col, hit.row, hit.k + 1);
    const corners = [centre, a, b];
    const centroid = { x: (centre.x + a.x + b.x) / 3, y: (centre.y + a.y + b.y) / 3 };
    // the triangles are equilateral with side `side`: scaling about the centroid
    // by (1 − inset / inradius) moves every side inward by exactly `inset`
    const factor = Math.max(0, 1 - inset / (settings.side / (2 * Math.sqrt(3))));
    return {
      kind: "outline",
      points: corners.map((p) => toWorld(settings, { x: centroid.x + (p.x - centroid.x) * factor, y: centroid.y + (p.y - centroid.y) * factor })),
      width,
      color: next === 0 ? settings.backgroundColor : stateColor(settings, next),
    };
  }
  const on = hasElement(model, hit.kind, hit.col, hit.row, hit.k);
  if (hit.kind === "vertex") {
    const point = hit.k === CENTRE ? centre : cellVertex(settings, hit.col, hit.row, hit.k);
    // a dotted ring; the dots themselves can be far smaller than a cursor, so
    // the ring never shrinks below a readable size on screen. Background-colour
    // dots only make sense while the ring still lies on the filled dot; once
    // the minimum size lifts it off the dot, the dot inside shows the state.
    const minDiameter = HOVER_RING_MIN_PX / scale;
    const onDot = on && settings.vertexDiameter >= minDiameter;
    const width = Math.max(settings.vertexDiameter / 3, HOVER_RING_MIN_STROKE_PX / scale);
    const diameter = Math.max(settings.vertexDiameter, minDiameter);
    return {
      kind: "ring",
      center: toWorld(settings, point),
      // a ring cut into the dot stays inside its edge
      radius: (onDot ? diameter - width : diameter) / 2,
      width,
      color: onDot ? settings.backgroundColor : settings.vertexColor,
    };
  }
  const start = hit.kind === "edge" ? cellVertex(settings, hit.col, hit.row, hit.k) : centre;
  const end = cellVertex(settings, hit.col, hit.row, hit.kind === "edge" ? hit.k + 1 : hit.k);
  const color = hit.kind === "edge" ? settings.outlineColor : settings.spokeColor;
  return {
    kind: "line",
    a: toWorld(settings, start),
    b: toWorld(settings, end),
    width: hit.kind === "edge" ? settings.outlineWidth : settings.spokeWidth,
    color: on ? settings.backgroundColor : color,
  };
}

const STEPS: Record<NumericSetting, number> = {
  columns: 1,
  rows: 1,
  side: 0.5,
  orientationDeg: 1,
  outlineWidth: 0.05,
  spokeWidth: 0.05,
  vertexDiameter: 0.05,
  stateCount: 1,
};

function NumberField({
  label,
  name,
  settings,
  onChange,
}: {
  label: string;
  name: NumericSetting;
  settings: GridSettings;
  onChange: (patch: Partial<GridSettings>) => void;
}) {
  const { min, max } = LIMITS[name];
  // live updates while typing only for in-range values; clamp when the field commits
  function onInput(event: Event) {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(value) && value >= min && value <= max) onChange({ [name]: clampSetting(name, value) });
  }
  function onCommit(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const value = clampSetting(name, input.valueAsNumber);
    input.value = String(value);
    onChange({ [name]: value });
  }
  return (
    <label>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={STEPS[name]}
        value={settings[name]}
        onInput={onInput}
        onChange={onCommit}
      />
    </label>
  );
}

function ColorField({
  label,
  name,
  settings,
  onChange,
}: {
  label: string;
  name: "outlineColor" | "spokeColor" | "vertexColor" | "backgroundColor";
  settings: GridSettings;
  onChange: (patch: Partial<GridSettings>) => void;
}) {
  return (
    <label>
      {label}
      <input
        type="color"
        value={settings[name]}
        onInput={(event) => onChange({ [name]: event.currentTarget.value })}
      />
    </label>
  );
}
