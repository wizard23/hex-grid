import test from "node:test";
import assert from "node:assert/strict";
import { PASSWORD_MIN_LENGTH, validatePassword, validateUsername } from "./index.js";

test("validateUsername accepts 3-20 chars of a-z, 0-9, - and _", () => {
  for (const good of ["abc", "a-b_c9", "x".repeat(20)]) {
    assert.equal(validateUsername(good), null, good);
  }
});

test("validateUsername rejects bad input with a human-readable reason", () => {
  for (const bad of ["ab", "x".repeat(21), "Alice", "has space", "nope!", ""]) {
    const reason = validateUsername(bad);
    assert.equal(typeof reason, "string", bad);
    assert.ok((reason ?? "").length > 0, bad);
  }
});

test("validatePassword enforces the minimum length", () => {
  assert.equal(validatePassword("x".repeat(PASSWORD_MIN_LENGTH)), null);
  const reason = validatePassword("x".repeat(PASSWORD_MIN_LENGTH - 1));
  assert.equal(typeof reason, "string");
});
