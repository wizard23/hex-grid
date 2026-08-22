import test from "node:test";
import assert from "node:assert/strict";
import { createModel, toggleSpoke } from "./model";
import { DEFAULT_SETTINGS } from "./settings";
import { parseDocument, parseSettings, serializeDocument } from "./file";

test("a document survives a save/load round trip", () => {
  const settings = { ...DEFAULT_SETTINGS, columns: 3, rows: 2, orientationDeg: 15, spokeColor: "#ff00ff" };
  const model = toggleSpoke(createModel(3, 2), 2, 1, 5);
  const loaded = parseDocument(serializeDocument({ settings, model }));
  assert.deepEqual(loaded.settings, settings);
  assert.deepEqual([...loaded.model.spokes], [...model.spokes]);
});

test("parseDocument rejects foreign or corrupt input with a readable message", () => {
  assert.throws(() => parseDocument("{"), /not valid JSON/);
  assert.throws(() => parseDocument('{"format":"todo"}'), /not a hex-grid file/);
  assert.throws(() => parseDocument('{"format":"hex-grid","version":2}'), /unsupported version/);
  assert.throws(
    () => parseDocument('{"format":"hex-grid","version":1,"settings":{"columns":2,"rows":2},"spokes":[1,2,3]}'),
    /expected 4 cell bytes/,
  );
});

test("parseSettings clamps numbers and falls back to defaults", () => {
  const s = parseSettings({ columns: 9999, rows: 2.6, side: "x", outlineColor: "red", backgroundColor: "#123456" });
  assert.equal(s.columns, 300);
  assert.equal(s.rows, 3);
  assert.equal(s.side, DEFAULT_SETTINGS.side);
  assert.equal(s.outlineColor, DEFAULT_SETTINGS.outlineColor);
  assert.equal(s.backgroundColor, "#123456");
  assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS);
});
