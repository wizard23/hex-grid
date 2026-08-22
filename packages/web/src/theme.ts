export const THEMES = [
  { id: "dark", label: "dark" },
  { id: "light", label: "light" },
  { id: "ocean", label: "ocean" },
  { id: "forest", label: "forest" },
  { id: "volcano", label: "volcano" },
  { id: "northern-lights", label: "violet northern lights" },
] as const;

export type Theme = (typeof THEMES)[number]["id"];

const STORAGE_KEY = "theme";
const DEFAULT_THEME: Theme = "dark";

export function currentTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  const known = THEMES.find((t) => t.id === stored);
  return known?.id ?? DEFAULT_THEME;
}

/** set the data-theme attribute the token blocks in styles.css key off */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
}

export function initTheme(): void {
  document.documentElement.dataset.theme = currentTheme();
}
