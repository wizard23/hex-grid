import test from "node:test";
import assert from "node:assert/strict";
import { CENTRE, createModel, toggleEdge, toggleSpoke, toggleVertex } from "./model";
import { DEFAULT_SETTINGS } from "./settings";
import { parseDocument, parseSettings, serializeDocument } from "./file";

test("a document survives a save/load round trip", () => {
  const settings = { ...DEFAULT_SETTINGS, columns: 3, rows: 2, orientationDeg: 15, spokeColor: "#ff00ff" };
  const model = toggleVertex(toggleEdge(toggleSpoke(createModel(3, 2), 2, 1, 5), 0, 0, 2), 1, 1, CENTRE);
  const loaded = parseDocument(serializeDocument({ settings, model }));
  assert.deepEqual(loaded.settings, settings);
  assert.deepEqual([...loaded.model.spokes], [...model.spokes]);
  assert.deepEqual([...loaded.model.edges], [...model.edges]);
  assert.deepEqual([...loaded.model.vertices], [...model.vertices]);
});

test("version 2 files (no vertices) load with every vertex hidden", () => {
  const loaded = parseDocument(
    '{"format":"hex-grid","version":2,"settings":{"columns":2,"rows":1},"spokes":[1,2],"edges":[3,4]}',
  );
  assert.deepEqual([...loaded.model.edges], [3, 4]);
  assert.deepEqual([...loaded.model.vertices], [0, 0]);
});

test("version 1 files (spokes only) load with every edge drawn", () => {
  const loaded = parseDocument('{"format":"hex-grid","version":1,"settings":{"columns":2,"rows":1},"spokes":[1,2]}');
  assert.deepEqual([...loaded.model.spokes], [1, 2]);
  assert.deepEqual([...loaded.model.edges], [63, 63]);
});

test("parseDocument rejects foreign or corrupt input with a readable message", () => {
  assert.throws(() => parseDocument("{"), /not valid JSON/);
  assert.throws(() => parseDocument('{"format":"todo"}'), /not a hex-grid file/);
  assert.throws(() => parseDocument('{"format":"hex-grid","version":4}'), /unsupported version/);
  assert.throws(
    () => parseDocument('{"format":"hex-grid","version":1,"settings":{"columns":2,"rows":2},"spokes":[1,2,3]}'),
    /expected 4 spoke bytes/,
  );
  assert.throws(
    () => parseDocument('{"format":"hex-grid","version":2,"settings":{"columns":2,"rows":2},"spokes":[1,2,3,4]}'),
    /expected 4 edge bytes/,
  );
  assert.throws(
    () =>
      parseDocument(
        '{"format":"hex-grid","version":3,"settings":{"columns":1,"rows":1},"spokes":[1],"edges":[1],"vertices":[]}',
      ),
    /expected 1 vertex bytes/,
  );
});

test("parseSettings clamps numbers and falls back to defaults", () => {
  const s = parseSettings({ columns: 9999, rows: 2.6, side: "x", outlineColor: "red", backgroundColor: "#123456", vertexColor: "#abcdef" });
  assert.equal(s.columns, 300);
  assert.equal(s.rows, 3);
  assert.equal(s.side, DEFAULT_SETTINGS.side);
  assert.equal(s.outlineColor, DEFAULT_SETTINGS.outlineColor);
  assert.equal(s.backgroundColor, "#123456");
  assert.equal(s.vertexColor, "#abcdef");
  assert.equal(s.vertexDiameter, DEFAULT_SETTINGS.vertexDiameter);
  assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS);
});
