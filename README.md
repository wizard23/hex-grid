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
  width/colour, vertex dot diameter/colour, number of fill states with one colour per
  state ≥ 1 (default 3 states, nine greys as the palette), background colour.
- **Editing:** mouse wheel zooms about the cursor, left-drag pans. Every element of a cell
  is clickable: the six hex edges, the six centre-to-corner "triangle" lines and the seven
  vertices (six corners + centre, drawn as filled dots, hidden by default) toggle; the six
  triangles step through their fill states (0 = unfilled … n−1) on click and reset to 0 on
  shift-click. Hovering shows the element dotted — a dotted line, ring or triangle outline
  — in its own colour when it is off and in the background colour when it is on; for a
  triangle the outline is in the colour the next click will give it. Presets: "Hex grid"
  (edges only), "Triangle grid" (all lines), "All vertices" / "No vertices", "No fills",
  "Clear" (nothing). Dot-grid paper = "Clear" + "All vertices".
- **Files:** "Download SVG" exports the drawing (every hex edge and corner exactly once;
  fills per state, edges, triangle lines and dots on their own paths, fills at the bottom);
  "Save JSON" / "Load JSON" store settings plus one edge, one triangle-line, one vertex and
  six triangle-state bytes per cell (format version 4; older files load with all edges on /
  no vertices / no fills). The current state is also autosaved to the browser's
  localStorage.

- **Stamps:** *Select cells* mode (click selects, click again deselects, double-click sets
  a symmetry centre snapped to cell centres / corners / edge midpoints); "Save stamp"
  puts the selection into a collapsible palette (IndexedDB; names auto-generated from the
  timestamp, editable; export/import as JSON). Stamps can be placed (ghost preview, R
  rotates, F mirrors, replace/merge), edited in a sub-editor (non-member cells locked,
  membership editable), and used to **tile the whole grid** under any of the 14 wallpaper
  groups a hex grid supports (p1 p2 p3 p3m1 p31m p6 p6m pm pg cm pmm pmg pgg cmm) with
  typed axial lattice vectors, a movable centre, live preview with orbit/gap/conflict
  counts ("first copy wins" on conflicts) and a fundamental-domain highlight. A stamp
  remembers its symmetry; editing it then applies every change to the whole symmetry
  orbit. Undo/redo (Ctrl+Z / Ctrl+Y) covers all of it.

Implementation notes: `packages/web/src/hexgrid/` — `geometry.ts` (flat-top layout, axial
rounding, rotation), `model.ts` (6 edge bits + 6 triangle-line bits + 7 vertex bits + 6 triangle-state bytes per
cell; a shared edge or corner is stored once on its canonical owner), `svg.ts`
(path/document generation,
used by preview and export), `hit.ts` (arithmetic hover/click hit-testing), `file.ts`
(JSON format), `transform.ts` (exact integer isometries of the hex lattice),
`symmetry.ts` (wallpaper groups, orbit closure, tiling), `stamp.ts` + `stamps-db.ts`
(stamp capture/placement, IndexedDB library), `select.ts`, `history.ts`,
`HexGridScreen.tsx` + `StampPanel.tsx` (the preact screens). Plan and measurements:
`docs/plans/2026-08-22--hex-grid-editor.md`.
