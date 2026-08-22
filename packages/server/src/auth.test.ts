import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { FastifyInstance } from "fastify";
import type { User } from "@asimov/shared";
import { buildApp } from "./app.js";
import { createTestApp, testConfig } from "./test-helpers.js";

interface AuthBody {
  data: { user: User; token: string };
}

function signup(app: FastifyInstance, payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/v1/auth/signup", payload });
}

function login(app: FastifyInstance, payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/v1/auth/login", payload });
}

test("signup creates an account and returns user + token", async () => {
  const { app, close } = await createTestApp();
  try {
    const res = await signup(app, { username: "alice", password: "hunter2hunter2" });
    assert.equal(res.statusCode, 201);
    const { data } = res.json<AuthBody>();
    assert.equal(data.user.username, "alice");
    assert.match(data.user.id, /^usr_/);
    assert.equal(data.user.email, undefined);
    assert.ok(data.token.length > 0);
    assert.ok(!res.body.includes("assword"), "no password material in response");
  } finally {
    await close();
  }
});

test("signup accepts an optional email", async () => {
  const { app, close } = await createTestApp();
  try {
    const res = await signup(app, {
      username: "bob",
      password: "hunter2hunter2",
      email: "bob@example.com",
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json<AuthBody>().data.user.email, "bob@example.com");
  } finally {
    await close();
  }
});

test("signup rejects a taken username with 409 problem+json", async () => {
  const { app, close } = await createTestApp();
  try {
    await signup(app, { username: "alice", password: "hunter2hunter2" });
    const res = await signup(app, { username: "alice", password: "otherpassword" });
    assert.equal(res.statusCode, 409);
    assert.match(res.headers["content-type"] ?? "", /^application\/problem\+json/);
    assert.equal(res.json<{ title: string }>().title, "Conflict");
  } finally {
    await close();
  }
});

test("signup validates username, password, and email", async () => {
  const { app, close } = await createTestApp();
  try {
    const cases: Record<string, unknown>[] = [
      { username: "Not Valid!", password: "hunter2hunter2" },
      { username: "carol", password: "short" },
      { username: "carol", password: "hunter2hunter2", email: "not-an-email" },
      { username: "carol" },
    ];
    for (const payload of cases) {
      const res = await signup(app, payload);
      assert.equal(res.statusCode, 400, JSON.stringify(payload));
      assert.match(res.headers["content-type"] ?? "", /^application\/problem\+json/);
    }
  } finally {
    await close();
  }
});

test("login returns a token for valid credentials", async () => {
  const { app, close } = await createTestApp();
  try {
    await signup(app, { username: "alice", password: "hunter2hunter2" });
    const res = await login(app, { username: "alice", password: "hunter2hunter2" });
    assert.equal(res.statusCode, 200);
    const { data } = res.json<AuthBody>();
    assert.equal(data.user.username, "alice");
    assert.ok(data.token.length > 0);
  } finally {
    await close();
  }
});

test("login responds identically for unknown user and wrong password", async () => {
  const { app, close } = await createTestApp();
  try {
    await signup(app, { username: "alice", password: "hunter2hunter2" });
    const unknown = await login(app, { username: "nobody", password: "hunter2hunter2" });
    const wrongPw = await login(app, { username: "alice", password: "wrongpassword" });
    assert.equal(unknown.statusCode, 401);
    assert.equal(wrongPw.statusCode, 401);
    assert.deepEqual(unknown.json(), wrongPw.json());
  } finally {
    await close();
  }
});

test("GET /v1/me requires a bearer token", async () => {
  const { app, close } = await createTestApp();
  try {
    const res = await app.inject({ method: "GET", url: "/v1/me" });
    assert.equal(res.statusCode, 401);
    assert.match(res.headers["content-type"] ?? "", /^application\/problem\+json/);
  } finally {
    await close();
  }
});

test("GET /v1/me returns the authenticated user", async () => {
  const { app, close } = await createTestApp();
  try {
    const created = await signup(app, {
      username: "alice",
      password: "hunter2hunter2",
      email: "alice@example.com",
    });
    const { token } = created.json<AuthBody>().data;
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 200);
    const { user } = res.json<{ data: { user: User } }>().data;
    assert.equal(user.username, "alice");
    assert.equal(user.email, "alice@example.com");
    assert.ok(!res.body.includes("assword"), "no password material in response");
  } finally {
    await close();
  }
});

test("tokens carry an expiry claim", async () => {
  const { app, close } = await createTestApp();
  try {
    const res = await signup(app, { username: "alice", password: "hunter2hunter2" });
    const { token } = res.json<AuthBody>().data;
    const claims = app.jwt.decode<{ exp?: number; iat?: number }>(token);
    assert.ok(claims?.exp !== undefined, "token has an exp claim");
    assert.ok(claims.iat !== undefined && claims.exp > claims.iat);
  } finally {
    await close();
  }
});

test("expired tokens are rejected with 401 problem+json", async () => {
  const { app, dataDir } = await createTestApp();
  await app.close();
  const shortLived = await buildApp({ ...testConfig(dataDir), tokenTtl: "1ms" });
  try {
    const res = await signup(shortLived, { username: "alice", password: "hunter2hunter2" });
    const { token } = res.json<AuthBody>().data;
    await delay(50);
    const me = await shortLived.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(me.statusCode, 401);
    assert.match(me.headers["content-type"] ?? "", /^application\/problem\+json/);
  } finally {
    await shortLived.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

function authed(token: string) {
  return { authorization: `Bearer ${token}` };
}

test("new accounts start at version 1 with updatedAt === createdAt", async () => {
  const { app, close } = await createTestApp();
  try {
    const { user } = (await signup(app, { username: "alice", password: "hunter2hunter2" })).json<AuthBody>().data;
    assert.equal(user.version, 1);
    assert.equal(user.updatedAt, user.createdAt);
  } finally {
    await close();
  }
});

test("PATCH /v1/me updates email, bumps version, never leaks the hash", async () => {
  const { app, close } = await createTestApp();
  try {
    const { user, token } = (await signup(app, { username: "alice", password: "hunter2hunter2" })).json<AuthBody>().data;
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: authed(token),
      payload: { email: "alice@example.com", version: user.version },
    });
    assert.equal(res.statusCode, 200);
    const updated = res.json<{ data: { user: User } }>().data.user;
    assert.equal(updated.email, "alice@example.com");
    assert.equal(updated.version, 2);
    assert.ok(updated.updatedAt >= updated.createdAt);
    assert.ok(!res.body.includes("assword"), "no password material in response");
  } finally {
    await close();
  }
});

test("PATCH /v1/me can change the password (old fails, new works)", async () => {
  const { app, close } = await createTestApp();
  try {
    const { token } = (await signup(app, { username: "alice", password: "hunter2hunter2" })).json<AuthBody>().data;
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: authed(token),
      payload: { password: "brand-new-pass", version: 1 },
    });
    assert.equal(res.statusCode, 200);
    assert.equal((await login(app, { username: "alice", password: "hunter2hunter2" })).statusCode, 401);
    assert.equal((await login(app, { username: "alice", password: "brand-new-pass" })).statusCode, 200);
  } finally {
    await close();
  }
});

test("PATCH /v1/me is version-guarded and rejects an empty patch", async () => {
  const { app, close } = await createTestApp();
  try {
    const { token } = (await signup(app, { username: "alice", password: "hunter2hunter2" })).json<AuthBody>().data;
    const stale = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: authed(token),
      payload: { email: "a@example.com", version: 99 },
    });
    assert.equal(stale.statusCode, 409);
    assert.match(stale.headers["content-type"] ?? "", /^application\/problem\+json/);
    const noVersion = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: authed(token),
      payload: { email: "a@example.com" },
    });
    assert.equal(noVersion.statusCode, 400);
    const empty = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: authed(token),
      payload: { version: 1 },
    });
    assert.equal(empty.statusCode, 400);
  } finally {
    await close();
  }
});

test("DELETE /v1/me removes the account and cascades its todos", async () => {
  const { app, dataDir, close } = await createTestApp();
  try {
    const { token } = (await signup(app, { username: "alice", password: "hunter2hunter2" })).json<AuthBody>().data;
    await app.inject({ method: "POST", url: "/v1/todos", headers: authed(token), payload: { title: "x" } });
    const stale = await app.inject({ method: "DELETE", url: "/v1/me?version=99", headers: authed(token) });
    assert.equal(stale.statusCode, 409);
    const res = await app.inject({ method: "DELETE", url: "/v1/me?version=1", headers: authed(token) });
    assert.equal(res.statusCode, 204);
    // account gone: login fails, and the token's user no longer resolves
    assert.equal((await login(app, { username: "alice", password: "hunter2hunter2" })).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: "/v1/me", headers: authed(token) })).statusCode, 401);
    // the todo is actually gone from disk, not merely orphaned
    const onDisk = JSON.parse(await readFile(join(dataDir, "todos.json"), "utf8")) as Record<string, unknown>;
    assert.equal(Object.keys(onDisk).length, 0);
  } finally {
    await close();
  }
});

test("accounts survive an app restart", async () => {
  const { app, dataDir } = await createTestApp();
  try {
    await signup(app, { username: "alice", password: "hunter2hunter2" });
    await app.close();
    const app2 = await buildApp(testConfig(dataDir));
    const res = await login(app2, { username: "alice", password: "hunter2hunter2" });
    assert.equal(res.statusCode, 200);
    await app2.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
