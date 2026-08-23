import { modelFromBytes, type GridModel } from "./model";
import { clampSetting, DEFAULT_SETTINGS, isColor, LIMITS, type GridSettings, type NumericSetting } from "./settings";

/**
 * The saved form of a grid: settings + one spoke, one edge and one vertex byte
 * per cell (row-major). Version 1 files carry spokes only (edges load as all
 * drawn), version 2 files carry no vertices (they load as hidden).
 */
export type GridDocument = { settings: GridSettings; model: GridModel };

const FORMAT = "hex-grid";
const VERSION = 3;
const READABLE_VERSIONS = new Set([1, 2, 3]);

export function serializeDocument({ settings, model }: GridDocument): string {
  return JSON.stringify(
    {
      format: FORMAT,
      version: VERSION,
      settings,
      spokes: [...model.spokes],
      edges: [...model.edges],
      vertices: [...model.vertices],
    },
    null,
    1,
  );
}

export function parseDocument(text: string): GridDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("not valid JSON");
  }
  if (!isRecord(raw) || raw.format !== FORMAT) throw new Error("not a hex-grid file");
  if (typeof raw.version !== "number" || !READABLE_VERSIONS.has(raw.version)) {
    throw new Error(`unsupported version ${String(raw.version)}`);
  }
  const settings = parseSettings(raw.settings);
  const cells = settings.columns * settings.rows;
  const spokes = parseBytes(raw.spokes, cells, "spoke");
  const edges = raw.version >= 2 ? parseBytes(raw.edges, cells, "edge") : undefined;
  const vertices = raw.version >= 3 ? parseBytes(raw.vertices, cells, "vertex") : undefined;
  return { settings, model: modelFromBytes(settings.columns, settings.rows, spokes, edges, vertices) };
}

function parseBytes(value: unknown, cells: number, what: string): number[] {
  if (!Array.isArray(value) || value.length !== cells || !value.every(isByte)) {
    throw new Error(`expected ${cells} ${what} bytes`);
  }
  return value;
}

/** settings from untrusted input; unknown/invalid fields fall back to the defaults */
export function parseSettings(raw: unknown): GridSettings {
  const source = isRecord(raw) ? raw : {};
  const settings: GridSettings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(LIMITS) as NumericSetting[]) {
    const value = source[key];
    settings[key] = clampSetting(key, typeof value === "number" ? value : NaN);
  }
  for (const key of ["outlineColor", "spokeColor", "vertexColor", "backgroundColor"] as const) {
    const value = source[key];
    if (isColor(value)) settings[key] = value;
  }
  return settings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isByte(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
}
