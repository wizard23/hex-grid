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
- **Editing:** mouse wheel zooms about the cursor, left-drag pans, hovering one of the six
  centre-to-corner lines of a cell shows it dotted, clicking toggles it. "Hex grid" clears
  all lines, "Triangle grid" enables all of them.
- **Files:** "Download SVG" exports the drawing (every hex edge exactly once, spokes on
  their own path); "Save JSON" / "Load JSON" store settings plus one byte per cell. The
  current state is also autosaved to the browser's localStorage.

Implementation notes: `packages/web/src/hexgrid/` — `geometry.ts` (flat-top layout, axial
rounding, rotation), `model.ts` (6 bits per cell), `svg.ts` (path/document generation,
used by preview and export), `hit.ts` (arithmetic hover/click hit-testing), `file.ts`
(JSON format), `HexGridScreen.tsx` (the preact screen). Plan and measurements:
`docs/plans/2026-08-22--hex-grid-editor.md`.
