import test from "node:test";
import assert from "node:assert/strict";
import { matchesTodoFilter, normalizeTags, parseTags, type Todo } from "./index.js";

test("parseTags splits, trims, dedupes, and drops empties", () => {
  assert.deepEqual(parseTags("a, b ,a,"), ["a", "b"]);
  assert.deepEqual(parseTags(""), []);
  assert.deepEqual(parseTags(" , ,"), []);
});

test("normalizeTags preserves first-seen order", () => {
  assert.deepEqual(normalizeTags([" b", "a", "b ", ""]), ["b", "a"]);
});

const todo: Todo = {
  id: "todo_1",
  ownerId: "usr_1",
  title: "t",
  done: true,
  tags: ["home", "urgent"],
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
  version: 1,
};

test("matchesTodoFilter combines tag and done criteria", () => {
  assert.equal(matchesTodoFilter(todo, {}), true);
  assert.equal(matchesTodoFilter(todo, { tag: "home" }), true);
  assert.equal(matchesTodoFilter(todo, { tag: "work" }), false);
  assert.equal(matchesTodoFilter(todo, { done: true }), true);
  assert.equal(matchesTodoFilter(todo, { done: false }), false);
  assert.equal(matchesTodoFilter(todo, { tag: "home", done: false }), false);
});
