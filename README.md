# hex-grid

Generates printable hex / triangle grid patterns (for custom notebooks) as SVG, on top of
the `@asimov` npm-workspace scaffold (see `AGENTS.md` for conventions and gates).

## Commands

```sh
npm install
npm run dev:app        # server + vite dev server (web on http://localhost:8989)
npm run lint && npm run typecheck && npm run build && npm test
npm run test:e2e       # headless browser suite (needs a build + `npx playwright install chromium`)
```

## Hex grid editor — `/hex-grid`

Client-side only; no login needed. Every size is in **millimetres** and the exported SVG
is sized in mm (`width="…mm"`, viewBox in the same units), so printing or converting to
PDF is true to size.

- **Settings:** columns, rows, side length, orientation (degrees, counter-clockwise; 0° =
  pointy tip sideways, 30° = pointy tip up), outline width/colour, triangle line
  width/colour, vertex dot diameter/colour, background colour.
- **Editing:** mouse wheel zooms about the cursor, left-drag pans. Every element of a cell
  can be toggled by clicking it: the six hex edges, the six centre-to-corner "triangle"
  lines, and the seven vertices (six corners + centre, drawn as filled dots, hidden by
  default). Hovering shows the element dotted — a dotted line or a dotted ring — in its own
  colour when it is off and in the background colour when it is on. Presets: "Hex grid"
  (edges only), "Triangle grid" (all lines), "All vertices" / "No vertices", "Clear"
  (nothing). Dot-grid paper = "Clear" + "All vertices".
- **Files:** "Download SVG" exports the drawing (every hex edge and corner exactly once;
  edges, triangle lines and dots on their own paths); "Save JSON" / "Load JSON" store
  settings plus one edge, one triangle-line and one vertex byte per cell (format version 3;
  older files load with all edges on / no vertices). The current state is also autosaved
  to the browser's localStorage.

Implementation notes: `packages/web/src/hexgrid/` — `geometry.ts` (flat-top layout, axial
rounding, rotation), `model.ts` (6 edge bits + 6 triangle-line bits + 7 vertex bits per cell; a shared edge or
corner is stored once on its canonical owner), `svg.ts` (path/document generation,
used by preview and export), `hit.ts` (arithmetic hover/click hit-testing), `file.ts`
(JSON format), `HexGridScreen.tsx` (the preact screen). Plan and measurements:
`docs/plans/2026-08-22--hex-grid-editor.md`.
