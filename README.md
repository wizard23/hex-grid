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
  width/colour, background colour.
- **Editing:** mouse wheel zooms about the cursor, left-drag pans. Every line — the six
  hex edges and the six centre-to-corner "triangle" lines of each cell — can be toggled by
  clicking it; hovering shows the line dotted (in the line's colour when it is off, in the
  background colour when it is on). Presets: "Hex grid" (edges only), "Triangle grid"
  (everything), "Clear" (nothing).
- **Files:** "Download SVG" exports the drawing (every hex edge exactly once, edges and
  triangle lines on their own paths); "Save JSON" / "Load JSON" store settings plus one edge
  byte and one triangle-line byte per cell (format version 2; version-1 files load with all
  edges on). The current state is also autosaved to the browser's localStorage.

Implementation notes: `packages/web/src/hexgrid/` — `geometry.ts` (flat-top layout, axial
rounding, rotation), `model.ts` (6 edge bits + 6 triangle-line bits per cell; a shared edge is stored once on
its canonical owner), `svg.ts` (path/document generation,
used by preview and export), `hit.ts` (arithmetic hover/click hit-testing), `file.ts`
(JSON format), `HexGridScreen.tsx` (the preact screen). Plan and measurements:
`docs/plans/2026-08-22--hex-grid-editor.md`.
