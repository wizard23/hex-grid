import test from "node:test";
import assert from "node:assert/strict";
import { createTestApp } from "./test-helpers.js";

test("GET /healthz responds with an ok envelope", async () => {
  const { app, close } = await createTestApp();
  try {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { data: { status: "ok" } });
  } finally {
    await close();
  }
});

test("unknown routes respond with problem+json", async () => {
  const { app, close } = await createTestApp();
  try {
    const res = await app.inject({ method: "GET", url: "/nope" });
    assert.equal(res.statusCode, 404);
    assert.match(res.headers["content-type"] ?? "", /^application\/problem\+json/);
    const body = res.json<{ title: string; status: number; instance: string }>();
    assert.equal(body.title, "Not Found");
    assert.equal(body.status, 404);
    assert.equal(body.instance, "/nope");
  } finally {
    await close();
  }
});

test("GET /openapi.json returns the generated spec", async () => {
  const { app, close } = await createTestApp();
  try {
    const res = await app.inject({ method: "GET", url: "/openapi.json" });
    assert.equal(res.statusCode, 200);
    const spec = res.json<{ openapi: string; paths: Record<string, unknown> }>();
    assert.equal(spec.openapi, "3.1.0");
    assert.ok("/healthz" in spec.paths);
  } finally {
    await close();
  }
});
