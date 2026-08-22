/**
 * User-facing grid settings. All lengths are millimetres; the exported SVG is
 * sized in mm so 1 user unit = 1 mm and prints true to size.
 */
export type GridShape = {
  /** number of hex columns / rows (odd-q offset layout in the local frame) */
  columns: number;
  rows: number;
  /** hex side length (= circumradius) in mm */
  side: number;
  /** rotation of the whole grid, counter-clockwise degrees; 0 = pointy tip sideways */
  orientationDeg: number;
};

export type GridStyle = {
  outlineWidth: number;
  outlineColor: string;
  /** the 6-fold triangle subdivision lines (centre → vertex) */
  spokeWidth: number;
  spokeColor: string;
  backgroundColor: string;
};

export type GridSettings = GridShape & GridStyle;

export const LIMITS = {
  columns: { min: 1, max: 300 },
  rows: { min: 1, max: 300 },
  side: { min: 0.5, max: 500 },
  orientationDeg: { min: -360, max: 360 },
  outlineWidth: { min: 0, max: 20 },
  spokeWidth: { min: 0, max: 20 },
} as const;

export type NumericSetting = keyof typeof LIMITS;

export const DEFAULT_SETTINGS: GridSettings = {
  columns: 10,
  rows: 8,
  side: 10,
  orientationDeg: 0,
  // 3 pt and 1 pt, rounded to tenths of a millimetre
  outlineWidth: 1.1,
  outlineColor: "#0000ff",
  spokeWidth: 0.4,
  spokeColor: "#d3d3d3",
  backgroundColor: "#000000",
};

const INTEGER_SETTINGS: ReadonlySet<NumericSetting> = new Set(["columns", "rows"]);

/** clamp a numeric setting into its allowed range (integers where required) */
export function clampSetting(key: NumericSetting, value: number): number {
  const { min, max } = LIMITS[key];
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS[key];
  const clamped = Math.min(max, Math.max(min, value));
  return INTEGER_SETTINGS.has(key) ? Math.round(clamped) : clamped;
}

const COLOR = /^#[0-9a-fA-F]{6}$/;

export function isColor(value: unknown): value is string {
  return typeof value === "string" && COLOR.test(value);
}
