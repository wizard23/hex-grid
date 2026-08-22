import test from "node:test";
import assert from "node:assert/strict";
import { request } from "undici";
import { createTestApp } from "./test-helpers.js";

// Everything else uses app.inject(); this test proves the server works over real HTTP.
test("smoke: serves /healthz over a real socket", async () => {
  const { app, close } = await createTestApp();
  try {
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const res = await request(`${address}/healthz`);
    assert.equal(res.statusCode, 200);
    const body = (await res.body.json()) as { data: { status: string } };
    assert.equal(body.data.status, "ok");
  } finally {
    await close();
  }
});
