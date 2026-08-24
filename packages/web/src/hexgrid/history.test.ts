import test from "node:test";
import assert from "node:assert/strict";
import { canRedo, canUndo, emptyHistory, pushHistory, redoHistory, undoHistory } from "./history";

test("undo/redo walks the edit chain", () => {
  let h = emptyHistory<string>();
  assert.equal(canUndo(h), false);
  assert.equal(undoHistory(h, "a"), null);
  h = pushHistory(h, "a"); // present became "b"
  h = pushHistory(h, "b"); // present became "c"
  assert.equal(canUndo(h), true);
  const u1 = undoHistory(h, "c");
  assert.ok(u1);
  assert.equal(u1.restored, "b");
  const u2 = undoHistory(u1.history, u1.restored);
  assert.ok(u2);
  assert.equal(u2.restored, "a");
  assert.equal(canUndo(u2.history), false);
  const r1 = redoHistory(u2.history, "a");
  assert.ok(r1);
  assert.equal(r1.restored, "b");
  assert.equal(canRedo(r1.history), true);
  const r2 = redoHistory(r1.history, "b");
  assert.ok(r2);
  assert.equal(r2.restored, "c");
  assert.equal(canRedo(r2.history), false);
});

test("a new edit clears the redo branch and the cap holds", () => {
  let h = emptyHistory<number>();
  h = pushHistory(h, 1);
  const u = undoHistory(h, 2);
  assert.ok(u);
  h = pushHistory(u.history, u.restored); // new edit from the restored state
  assert.equal(canRedo(h), false);
  h = emptyHistory<number>();
  for (let i = 0; i < 60; i++) h = pushHistory(h, i, 50);
  assert.equal(h.past.length, 50);
  assert.equal(h.past[0], 10);
});
