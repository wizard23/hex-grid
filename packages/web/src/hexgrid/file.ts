import { modelFromBytes, type GridModel } from "./model";
import { clampSetting, DEFAULT_SETTINGS, isColor, LIMITS, type GridSettings, type NumericSetting } from "./settings";

/** the saved form of a grid: settings + one byte per cell (row-major) */
export type GridDocument = { settings: GridSettings; model: GridModel };

const FORMAT = "hex-grid";
const VERSION = 1;

export function serializeDocument({ settings, model }: GridDocument): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, settings, spokes: [...model.spokes] }, null, 1);
}

export function parseDocument(text: string): GridDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("not valid JSON");
  }
  if (!isRecord(raw) || raw.format !== FORMAT) throw new Error("not a hex-grid file");
  if (raw.version !== VERSION) throw new Error(`unsupported version ${String(raw.version)}`);
  const settings = parseSettings(raw.settings);
  const spokes = raw.spokes;
  const cells = settings.columns * settings.rows;
  if (!Array.isArray(spokes) || spokes.length !== cells || !spokes.every(isByte)) {
    throw new Error(`expected ${cells} cell bytes`);
  }
  return { settings, model: modelFromBytes(settings.columns, settings.rows, spokes) };
}

/** settings from untrusted input; unknown/invalid fields fall back to the defaults */
export function parseSettings(raw: unknown): GridSettings {
  const source = isRecord(raw) ? raw : {};
  const settings: GridSettings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(LIMITS) as NumericSetting[]) {
    const value = source[key];
    settings[key] = clampSetting(key, typeof value === "number" ? value : NaN);
  }
  for (const key of ["outlineColor", "spokeColor", "backgroundColor"] as const) {
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
