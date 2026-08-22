import test from "node:test";
import assert from "node:assert/strict";
import { parseRoute, ROUTE_PATHS } from "./route";

test("parseRoute maps paths to routes, unknown paths to todos", () => {
  assert.equal(parseRoute("/"), "todos");
  assert.equal(parseRoute(""), "todos");
  assert.equal(parseRoute("/hex-grid"), "hex-grid");
  assert.equal(parseRoute("/hex-grid/"), "hex-grid");
  assert.equal(parseRoute("/nope"), "todos");
  for (const [route, path] of Object.entries(ROUTE_PATHS)) assert.equal(parseRoute(path), route);
});
