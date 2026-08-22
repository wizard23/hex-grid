import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Point } from "./geometry";
import { parseDocument, serializeDocument, type GridDocument } from "./file";
import { hitSpoke, type SpokeHit } from "./hit";
import { ALL_SPOKES, createModel, fillModel, resizeModel, toggleSpoke } from "./model";
import { clampSetting, DEFAULT_SETTINGS, LIMITS, type GridSettings, type NumericSetting } from "./settings";
import { cellCenter, cellVertex, toWorld } from "./geometry";
import { documentBounds, fmt, outlineSegments, spokeBands, toPathData, toSvgDocument, type SpokeBands } from "./svg";

/**
 * screen px = world mm · scale + (tx, ty). The view is applied through the
 * svg's viewBox, not a transform on a group: a transform that changes every
 * frame makes browsers cache the drawing as a bitmap and scale that (fuzzy
 * until they re-rasterise), while a viewBox change is a plain crisp repaint.
 */
type View = { scale: number; tx: number; ty: number };
type Size = { width: number; height: number };

const STORAGE_KEY = "hex-grid";
const HIT_TOLERANCE_PX = 8;
const DRAG_THRESHOLD_PX = 3;
const MIN_SCALE = 0.05;
const MAX_SCALE = 400;
const AUTOSAVE_DELAY_MS = 300;
const SPOKE_BAND_ROWS = 8;

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
  const [view, setView] = useState<View>({ scale: 4, tx: 0, ty: 0 });
  const [hover, setHover] = useState<SpokeHit | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fitted, setFitted] = useState(false);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const bandCache = useRef<SpokeBands | undefined>(undefined);

  const { settings, model } = doc;
  const { columns, rows, side, orientationDeg, outlineWidth, spokeWidth } = settings;
  const shapeDeps = [columns, rows, side, orientationDeg];

  // path strings are rebuilt only when the geometry (or the spokes) change — never on pan/zoom
  const outlinePath = useMemo(() => toPathData(outlineSegments(settings)), shapeDeps);
  const spokePaths = useMemo(() => {
    bandCache.current = spokeBands(settings, model, SPOKE_BAND_ROWS, bandCache.current);
    return bandCache.current.paths;
  }, [...shapeDeps, model]);
  const bounds = useMemo(() => documentBounds(settings), [...shapeDeps, outlineWidth, spokeWidth]);

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
    setDoc((d) => {
      const next = { ...d.settings, ...patch };
      return { settings: next, model: resizeModel(d.model, next.columns, next.rows) };
    });
  }

  function setSpokes(bits: number) {
    setDoc((d) => ({ ...d, model: fillModel(d.model, bits) }));
  }

  function toWorldPoint(p: Point): Point {
    return { x: (p.x - view.tx) / view.scale, y: (p.y - view.ty) / view.scale };
  }

  function hitAt(p: Point): SpokeHit | null {
    return hitSpoke(settings, toWorldPoint(p), HIT_TOLERANCE_PX / view.scale);
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
      setHover(hitAt(p));
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
    const hit = hitAt(localPointer(svg, event));
    if (hit === null) return;
    setDoc((current) => ({ ...current, model: toggleSpoke(current.model, hit.col, hit.row, hit.k) }));
  }

  function onPointerLeave() {
    if (drag.current === null) setHover(null);
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
        setDoc(parseDocument(text));
        setError(null);
        setFitted(false);
      })
      .catch((err: unknown) => setError(`Could not load file: ${err instanceof Error ? err.message : String(err)}`));
  }

  const hoverLine = hover === null ? null : hoverSegment(settings, hover);
  const viewportClass = `grid-viewport${dragging ? " dragging" : hover !== null ? " hovering" : ""}`;
  const paperWidth = bounds.maxX - bounds.minX;
  const paperHeight = bounds.maxY - bounds.minY;
  const viewBox = `${-view.tx / view.scale} ${-view.ty / view.scale} ${Math.max(size.width, 1) / view.scale} ${Math.max(size.height, 1) / view.scale}`;

  return (
    <div class="hexgrid">
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
            <ColorField label="Background" name="backgroundColor" settings={settings} onChange={updateSettings} />
          </div>
          <div class="actions">
            <button type="button" onClick={() => setSpokes(0)}>
              Hex grid
            </button>
            <button type="button" onClick={() => setSpokes(ALL_SPOKES)}>
              Triangle grid
            </button>
            <button type="button" onClick={fitView}>
              Fit
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
            Wheel zooms, left-drag pans, click a centre-to-corner line to toggle it. Sizes are millimetres; the
            SVG prints true to size.
          </p>
          <p class="grid-status">
            {columns * rows} cells · {fmt(paperWidth)} × {fmt(paperHeight)} mm · zoom {Math.round(view.scale * 100) / 100}{" "}
            px/mm
          </p>
        </form>
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
        >
          <rect
            x={bounds.minX}
            y={bounds.minY}
            width={paperWidth}
            height={paperHeight}
            fill={settings.backgroundColor}
          />
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
          <path
            d={outlinePath}
            fill="none"
            stroke={settings.outlineColor}
            stroke-width={outlineWidth}
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          {hoverLine !== null && (
            // a screen-space cursor hint: non-scaling-stroke keeps the 2 px
            // dots evenly spaced at every zoom level
            <line
              class="grid-hover"
              x1={hoverLine.a.x}
              y1={hoverLine.a.y}
              x2={hoverLine.b.x}
              y2={hoverLine.b.y}
              vector-effect="non-scaling-stroke"
              stroke-width="2"
              stroke-dasharray="0 6"
              stroke-linecap="round"
            />
          )}
        </svg>
      </div>
    </div>
  );
}

function localPointer(svg: SVGSVGElement, event: { clientX: number; clientY: number }): Point {
  const rect = svg.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function hoverSegment(settings: GridSettings, hit: SpokeHit): { a: Point; b: Point } {
  return {
    a: toWorld(settings, cellCenter(settings, hit.col, hit.row)),
    b: toWorld(settings, cellVertex(settings, hit.col, hit.row, hit.k)),
  };
}

const STEPS: Record<NumericSetting, number> = {
  columns: 1,
  rows: 1,
  side: 0.5,
  orientationDeg: 1,
  outlineWidth: 0.05,
  spokeWidth: 0.05,
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
  name: "outlineColor" | "spokeColor" | "backgroundColor";
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
