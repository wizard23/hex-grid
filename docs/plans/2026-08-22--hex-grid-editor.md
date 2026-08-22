# Hex / triangle grid editor (client-side route)

Date: 2026-08-22

## Goal

A client-side-only route `/hex-grid` that renders an editable hex grid as SVG, lets the
user toggle the six "spokes" (centre → vertex lines of the 6-fold triangle subdivision)
per cell, and exports the result as an SVG document sized in millimetres for printing
(notebook patterns). The triangle grid is the hex grid with all spokes enabled.

## Decisions (from the planning discussion)

- **Units: everything in mm.** The SVG is `width="…mm" height="…mm"` with a viewBox in
  the same numbers, so 1 user unit = 1 mm and print-to-PDF is true to size.
- **Orientation** is a rigid rotation of the whole grid (counter-clockwise, degrees) about
  its centre; 0° = flat side up / pointy tip sideways, 30° = pointy tip up.
- **Triangle lines** = the spokes; one width and one colour applies to all of them.
- **Background colour** is an input (default black); it is exported into the SVG.
- **Persistence:** autosave to `localStorage`; explicit save/load as a JSON file.
- **No server / shared changes.** The todos scaffold stays untouched apart from the
  menubar link and the router.

## Performance design

Large grids are made interactive by construction, not by rendering tech:

- The live SVG has a constant number of elements (paper, outline path, spoke path, hover
  line). Every hex edge is emitted exactly once (cell emits edge *d* only when *d* < 3 or the
  neighbour is missing).
- Hover/click hit-testing is arithmetic (pointer → world → axial round → nearest spoke),
  not per-element DOM listeners.
- Path strings are memoised on the settings/model; pan/zoom only touch a `transform`.
- Generation (`geometry.ts`, `svg.ts`) is pure and separate from the preview component, so
  a Canvas2D (or GPU) preview could be swapped in later without touching the export.

Measurement (see "Verification") decides whether anything more is needed; the expected
working range (A4/A5 page, 2–15 mm cells) is < 10k cells.

## Slices

1. **Router** — `route.ts` (`/` todos, `/hex-grid` editor), menubar link. Works with the
   existing SPA fallback in the server and vite dev.
2. **Geometry + model** (`hexgrid/geometry.ts`, `hexgrid/model.ts`), TDD: cell centres and
   vertices, axial rounding, neighbour lookup, spoke bits, resize keeps bits.
3. **SVG generation** (`hexgrid/svg.ts`), TDD: no duplicate edges, edge count, spoke
   count = popcount, mm-sized document; `hexgrid/hit.ts` hit-testing; `hexgrid/file.ts`
   JSON format with `unknown`-parsing.
4. **Editor UI** (`hexgrid/HexGridScreen.tsx`): settings form, zoom (wheel, about cursor),
   pan (left drag), hover overlay (dotted), click toggles, fit, presets, SVG/JSON
   download, JSON load, localStorage autosave.
5. **Docs**: this plan, AGENTS.md repo map, README section.

## Verification

`npm run lint && npm run typecheck && npm run build && npm test` after each slice; manual
browser check of zoom/pan/hover/toggle/export; timing of path generation for a 200×200 grid
recorded below.

## Measurements

Path generation in node (tsx, 5th run), orientation 17°, all spokes on:

| grid | outline path | spoke path (one toggle) | full SVG export |
|---|---|---|---|
| 50×50 (2.5k cells) | 13 ms / 0.2 MB | 15 ms / 0.5 MB | 29 ms / 0.7 MB |
| 100×100 (10k) | 45 ms / 1.0 MB | 54 ms / 2.0 MB | 118 ms / 3.0 MB |
| 200×200 (40k) | 204 ms / 4.1 MB | 384 ms / 8.2 MB | 579 ms / 12.4 MB |
| 300×300 (90k) | 493 ms / 9.4 MB | 1046 ms / 18.8 MB | 1296 ms / 28.2 MB |

Decision: rebuilding one spoke path per click was too slow above ~20k cells, so the
preview renders spokes as one `<path>` per band of 8 rows (`spokeBands` in `svg.ts`);
a toggle rebuilds only its band (≈ 1/40 of the work at 300 rows) and the browser re-parses
only that band's `d`. Outline rebuilds happen only on shape changes and stay under
0.5 s even at the 300×300 limit. The dimension limits (300×300) are set accordingly. Nothing
beyond SVG was needed; a Canvas2D preview remains the next step if larger grids are ever
required.

Headless check (playwright, built server): deep link, fit, wheel zoom, drag pan, hover
overlay, click toggle on/off, triangle preset, mm-sized SVG download, localStorage restore
after reload, menubar navigation + browser back — all passing, no console errors.

## Follow-up 2026-08-22: preview zoom fuzz + hover dots

Root causes and fixes (no geometry/export changes):

- **Fuzzy after zoom, sharp later** — pan/zoom rewrote a `<g transform>` every wheel tick;
  browsers treat a constantly changing transform as an animation, cache the group as a
  bitmap and scale it (blurry), re-rasterising only once the transform has been still for a
  while. Fix: the view is now applied through the `<svg viewBox>` (same affine map, same
  hit-test math), which is a plain repaint every frame — always crisp.
- **Hover line dotted only when zoomed out** — dash/gap were 3 screen px but the stroke
  width was `max(spokeWidth, 2/scale)` with round caps, so once the width passed 3 px the
  caps swallowed the gaps. Fix: the hover line uses the triangle line's own width and
  a dash pattern in multiples of that width (`stroke-dasharray="0 2.5·w"`, round caps →
  dots one width across), so it is dotted at every zoom level — the `/scale` arithmetic is
  gone.

Zoom cost per wheel tick (headless Chromium, software raster, wall time until two frames
after the tick, ~50 ms of which is driver overhead; all spokes on):

| grid | median | max |
|---|---|---|
| 10×10 | 67 ms | 75 ms |
| 100×100 | 112 ms | 118 ms |
| 300×300 | 633 ms | 912 ms |

Decision: crisp repaint per frame is fine through ~100×100 (the realistic notebook range
is far below that). At the 300×300 limit every tick now costs a full repaint, which reads
as sluggish where it previously read as "smooth but fuzzy". Kept as is; if large grids
matter, the next step is explicit gesture phases (CSS transform on the viewport during
the gesture, committed into the viewBox on pointer-up / wheel idle) — not done, pending a
check on real GPU hardware.

## Follow-up 2026-08-22: hover colour + toggleable hex edges

- Hover uses the hovered line's own width and colour, only dotted. Over a line that is
  already drawn, dots in the line colour would be invisible, so there the dots are drawn in
  the background colour — the solid line visibly turns dotted. Both states read as "the
  dotted version of this line".
- Hex edges are editable like the spokes. The model gains one `edges` byte per cell
  (default all on). A shared edge has exactly one owner (`canonicalEdge`: k < 3 → the cell,
  k ≥ 3 → the neighbour's k−3, boundary edges stay with the cell), so generation still emits
  every edge once and hover/click/toggle from either side address the same bit.
  `hitLine` returns the nearer of the closest spoke and the closest edge.
- The outline path is now banded like the spoke path (`pathBands(kind, …)`), since it is
  rebuilt on clicks too. JSON format version 2 adds `edges`; version 1 still loads.
- Presets: "Hex grid" = edges on / spokes off, "Triangle grid" = all on, "Clear" = all off.
