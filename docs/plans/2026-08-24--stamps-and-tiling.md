# Stamps and symmetric tiling

Date: 2026-08-24. Status: **implemented** (same day; go given).

## Goal

Copy/clone parts of a pattern via a named stamp palette, and tile the whole grid with a
stamp under any wallpaper symmetry the hex grid supports. Builds on the existing editor
(`packages/web/src/hexgrid/`), reusing its model, geometry and rendering.

## Decisions (agreed in discussion)

- **Selection**: a *Select cells* mode; single click selects a cell, clicking again
  deselects; drag keeps panning. **Double-click sets the symmetry centre**, snapping to the
  nearest centre type the current group allows (6-fold: cell centres; 3-fold: cell centres
  or vertices; 2-fold: cell centres or edge midpoints; mirror axes: cell centres in 6
  directions, vertices in 3, edge midpoints in 2).
- **Stamps**: cells in axial coordinates relative to an anchor + full element state per
  cell (6 spokes, 6 edges, 7 vertices, 6 triangle states; shared elements stored by every
  touching member cell, consistently). Stamps also store: name (auto-generated from the
  timestamp, e.g. "2026-08-24 09:15", editable inline), centre, and — once chosen — the
  symmetry group and lattice vectors. Orientation-independent (grid rotation irrelevant).
- **Library** in **IndexedDB** (not localStorage), one object store keyed by id: name,
  created/modified, payload, cached thumbnail SVG. Library export/import as JSON.
- **Thumbnails** use the document's colours; re-rendered when colours change.
- **Layout**: collapsible third column (settings | canvas | stamps).
- **Place** (manual stamping) stays independent of tiling: ghost follows the cursor
  snapped to the hovered cell, R rotates 60°, F mirrors, click places, Esc exits;
  replace / merge toggle (merge = OR lines/vertices, non-zero fills overwrite).
- **Edit**: opens the stamp in the main editor on its bounding box, non-member cells
  dimmed/locked; Select-cells edits membership; Save/Cancel; "Update from grid" re-captures
  an existing footprint. **Symmetric editing is on whenever a group is attached**: an edit
  is applied to the whole consistency class of the element, so constraints hold by
  construction.
- **Tiling**: whole grid only (tile-into-selection deferred). **All 14 hex-compatible
  wallpaper groups** in a gallery (p1, p2, p3, p3m1, p31m, p6, p6m, pm, pg, cm, pmm, pmg,
  pgg, cmm — everything but p4, p4g, p4m, whose 4-fold rotations don't preserve the hex
  lattice). **Lattice vectors typed as axial integers** with a drawn preview of u, v from
  the centre; hexagonal groups need only u (v = R·u), p1/p2 need u, v, rectangular groups
  constrain v ⊥ u (rhombic for cm/cmm). **Centre defaults** to the stamp's anchor cell
  centre if none was double-clicked (meaningful default; restricted per group as above).
  Conflicts: **"first copy wins" is allowed with a warning**; the preview shows conflict
  and gap counts before applying. Optional "clear grid first".
- **Undo/redo first** (Ctrl+Z / Ctrl+Y + buttons): prerequisite for all of this; trivial
  with the immutable model (history stack, capped e.g. at 100 entries).

## Mathematical core (summary; full derivation in the 2026-08-23 discussion)

- A pattern is a function on the element set E; symmetry group G ≤ p6m ⇔ the function is
  constant on G-orbits of E. Tiling = extend the stamp's values along orbits.
- Whole-cell stamps lose no generality: if the cell set C meets every G-orbit of cells,
  E(C) meets every element orbit ("spanning"). They are never minimal — boundary elements
  appear on both sides of the domain, and cells on rotation centres / mirror axes carry
  internal constraints — but that only yields *consistency conditions*, checked (or, with
  symmetric editing, enforced) automatically.
- Isometries are stored exactly as (2×2 integer matrix, integer translation) in axial
  coordinates; the action on elements is computed geometrically (map the element's
  representative point, resolve by cell/sector arithmetic) — no reflection index algebra.
- Orbit machinery: BFS closure of the generator set pruned to a window; union-find gives
  cell orbits (count N via the window; Burnside only as a cross-check in tests), covering
  (gaps), redundancy, and element-level consistency classes (conflicts). All small and
  exact.
- The **fundamental-domain helper**: after group/lattice/centre are set, highlight a
  canonical transversal (greedy BFS from the centre, one cell per unseen orbit); while
  selecting, show live N / covered / redundant (yellow) / missing (red) / constrained
  cells (icon per stabiliser); tiling preview ghosts the orbit with conflicts highlighted.

## Slices (each with gates: lint → typecheck → build → test; UI slices also headless-checked)

1. **Undo/redo.** History of `GridModel` in the screen; Ctrl+Z/Y, buttons; autosave
   unaffected. Tests: model history helper (pure).
2. **`transform.ts`.** Hex isometries: rotate60ᵏ / mirror / translate, compose, invert,
   equality; action on cells and on element ids (geometrically derived). Tests against
   `geometry.ts` (map point then resolve = resolve then map), all 12 point-group elements
   at cell centres, vertices, edge midpoints.
3. **`stamp.ts` + store.** Stamp type, capture(model, cells, anchor), apply(model, stamp,
   isometry, mode: replace|merge) with clipping, thumbnail sub-model rendering; IndexedDB
   wrapper (`stamps-db.ts`, promise-based, versioned schema); library export/import JSON.
   Tests: capture/apply round trips incl. shared boundary elements and fill capping;
   store tested against a fake IDB (interface-injected).
4. **Select mode + palette UI.** Selection overlay path; click/deselect; double-click
   centre picker with snapping; "Save as stamp"; collapsible third column with list,
   inline rename, Duplicate, Delete, Place, Edit, Tile buttons; thumbnails.
5. **Place mode.** Ghost rendering (reuses band generators on a temp model or direct
   path build), R/F, replace/merge, repeatable, Esc.
6. **Stamp editor.** Bounding-box sub-document, membership editing, symmetric editing
   when a group is attached, Save/Cancel, Update-from-grid.
7. **`symmetry.ts`.** Generator sets for the 14 groups (parameterised by u, v, centre),
   BFS orbit closure with window pruning, diagnostics (N, covering, redundancy,
   consistency classes, conflicts, gaps), canonical transversal suggestion. Pure; heavy
   test slice (Burnside cross-checks for p1/p2/p6 examples from the discussion; symmetric
   pattern round trips: build pattern from random values on a transversal, verify
   invariance under all generators).
8. **Tiling panel.** Gallery (14 entries, live preview with the actual stamp), axial
   integer inputs for u (and v where applicable) with drawn vectors from the centre,
   centre display/repick, domain suggestion overlay, conflict/gap counts, "first copy
   wins" warning, clear-first checkbox, Apply.

Deferred (explicitly out of scope now): tile-into-selection, stamp sharing beyond
JSON export, live whole-grid symmetry mode outside the stamp editor.

## Risks / notes

- JSON document format is untouched (stamps live in their own library); a later version
  may embed stamps in documents if sharing demands it.
- Performance: orbit enumeration is tiny; placing/tiling rebuilds bands as today. The
  selection/ghost layers are constant-size paths like every other layer.
- The stamp editor reuses `HexGridScreen` internals; slice 6 is where refactoring
  pressure will show up (extract the canvas viewport into its own component first if
  needed — behaviour-preserving prep, kept as its own commit).
- Centre-type snapping rules per group are part of `symmetry.ts` presets, tested.

## Outcome (2026-08-24)

All eight slices are implemented and verified: 125 unit tests across the web package
(gates lint → typecheck → build → test all green) and 82 headless-browser checks covering
select/save/rename/duplicate/delete/persist (IndexedDB across reload), place (ghost, R/F,
merge, undo/redo), the stamp editor (locked non-members, membership, save/cancel), and
tiling (p6 preview with orbit/copies/gaps/conflict counts, domain highlight, p1 gap
detection, apply + undo, conflict warning for an asymmetric stamp under p6, symmetric
editing painting a whole 6-spoke orbit in one click).

The engine's exactness is test-pinned: coset counts modulo the lattice equal the point
group orders for all 14 groups; Burnside cross-checks (p6 with the unit lattice → 1 cell
orbit, doubled lattice → 2); pg contains no pure mirror; **p3m1/p31m are distinguished by
the crystallographic property** (all 3-fold centres on mirrors ⇔ p3m1), which confirmed
the axis convention (p3m1: mirrors at 30° to u; p31m: mirrors along u).

Deviations from the plan, with reasons:

- **Thumbnails are rendered live**, not cached in IndexedDB: they use the document's
  colours, which change per document, so a cache would be invalid most of the time and
  they are cheap to render.
- **"Update from grid" was dropped**: stamps store no absolute grid location, so the
  operation has no well-defined footprint; the stamp editor plus Place covers the
  workflow.
- **Diagnostics** are shown as counts (orbits / copies / gaps / conflicts) plus the live
  preview and the optional fundamental-domain highlight — not as per-cell constraint
  icons. Symmetric editing makes the constraint icons redundant: with a group attached,
  consistency holds by construction.
- The tiling anchor is fixed to the cell nearest the grid centre (with the centre marker
  movable by double-click); a movable anchor can come later if needed.

Note for test authors: the settings column is taller than a laptop viewport; headless
checks must re-measure the svg's bounding box after any layout change (buttons appearing,
panel opening) or use a tall viewport — stale coordinates silently miss the canvas (two
debugging sessions went into exactly that).
