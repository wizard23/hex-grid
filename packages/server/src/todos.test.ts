import test from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import type { Todo } from "@asimov/shared";
import { createTestApp, type TestApp } from "./test-helpers.js";

interface TodoBody {
  data: { todo: Todo };
}

async function signupToken(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { username, password: "hunter2hunter2" },
  });
  assert.equal(res.statusCode, 201);
  return res.json<{ data: { token: string } }>().data.token;
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function createTodo(
  app: FastifyInstance,
  token: string,
  payload: Record<string, unknown>,
): Promise<Todo> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/todos",
    headers: auth(token),
    payload,
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json<TodoBody>().data.todo;
}

async function withApp(fn: (app: FastifyInstance) => Promise<void>): Promise<void> {
  const testApp: TestApp = await createTestApp();
  try {
    await fn(testApp.app);
  } finally {
    await testApp.close();
  }
}

test("todo routes require a bearer token", async () => {
  await withApp(async (app) => {
    const cases = [
      { method: "GET" as const, url: "/v1/todos" },
      { method: "POST" as const, url: "/v1/todos", payload: { title: "x" } },
      { method: "PATCH" as const, url: "/v1/todos/todo_x", payload: { done: true, version: 1 } },
      { method: "DELETE" as const, url: "/v1/todos/todo_x?version=1" },
    ];
    for (const c of cases) {
      const res = await app.inject(c);
      assert.equal(res.statusCode, 401, `${c.method} ${c.url}`);
      assert.match(res.headers["content-type"] ?? "", /^application\/problem\+json/);
    }
  });
});

test("POST creates a todo; tags round-trip and defaults apply", async () => {
  await withApp(async (app) => {
    const token = await signupToken(app, "alice");
    const tagged = await createTodo(app, token, {
      title: "write docs",
      tags: ["work", "writing"],
    });
    assert.match(tagged.id, /^todo_/);
    assert.equal(tagged.title, "write docs");
    assert.equal(tagged.done, false);
    assert.deepEqual(tagged.tags, ["work", "writing"]);
    const bare = await createTodo(app, token, { title: "no tags" });
    assert.deepEqual(bare.tags, []);
  });
});

test("GET lists only the caller's todos", async () => {
  await withApp(async (app) => {
    const alice = await signupToken(app, "alice");
    const bob = await signupToken(app, "bob");
    await createTodo(app, alice, { title: "alice 1" });
    await createTodo(app, alice, { title: "alice 2" });
    await createTodo(app, bob, { title: "bob 1" });
    const res = await app.inject({ method: "GET", url: "/v1/todos", headers: auth(alice) });
    assert.equal(res.statusCode, 200);
    const { todos } = res.json<{ data: { todos: Todo[] } }>().data;
    assert.deepEqual(
      todos.map((t) => t.title),
      ["alice 1", "alice 2"],
    );
  });
});

test("new todos start at version 1 with updatedAt === createdAt", async () => {
  await withApp(async (app) => {
    const token = await signupToken(app, "alice");
    const todo = await createTodo(app, token, { title: "fresh" });
    assert.equal(todo.version, 1);
    assert.equal(todo.updatedAt, todo.createdAt);
  });
});

test("PATCH applies at the seen version, bumps version and updatedAt", async () => {
  await withApp(async (app) => {
    const token = await signupToken(app, "alice");
    const todo = await createTodo(app, token, { title: "v1" });
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/todos/${todo.id}`,
      headers: auth(token),
      payload: { done: true, version: 1 },
    });
    assert.equal(res.statusCode, 200);
    const updated = res.json<TodoBody>().data.todo;
    assert.equal(updated.version, 2);
    assert.ok(updated.updatedAt >= updated.createdAt);
  });
});

test("stale writes get 409 problem+json and change nothing", async () => {
  await withApp(async (app) => {
    const token = await signupToken(app, "alice");
    const todo = await createTodo(app, token, { title: "contested", tags: ["home"] });
    // tab A wins the race
    await app.inject({
      method: "PATCH",
      url: `/v1/todos/${todo.id}`,
      headers: auth(token),
      payload: { tags: ["home", "garden"], version: 1 },
    });
    // tab B writes with the version it saw before A's change
    const stale = await app.inject({
      method: "PATCH",
      url: `/v1/todos/${todo.id}`,
      headers: auth(token),
      payload: { tags: ["home", "urgent"], version: 1 },
    });
    assert.equal(stale.statusCode, 409);
    assert.match(stale.headers["content-type"] ?? "", /^application\/problem\+json/);
    const current = await app.inject({
      method: "GET",
      url: `/v1/todos/${todo.id}`,
      headers: auth(token),
    });
    assert.deepEqual(current.json<TodoBody>().data.todo.tags, ["home", "garden"]);
    // stale delete is refused the same way
    const del = await app.inject({
      method: "DELETE",
      url: `/v1/todos/${todo.id}?version=1`,
      headers: auth(token),
    });
    assert.equal(del.statusCode, 409);
  });
});

test("PATCH and DELETE without a version are rejected with 400", async () => {
  await withApp(async (app) => {
    const token = await signupToken(app, "alice");
    const todo = await createTodo(app, token, { title: "x" });
    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/todos/${todo.id}`,
      headers: auth(token),
      payload: { done: true },
    });
    assert.equal(patch.statusCode, 400);
    const del = await app.inject({
      method: "DELETE",
      url: `/v1/todos/${todo.id}`,
      headers: auth(token),
    });
    assert.equal(del.statusCode, 400);
  });
});

test("GET /v1/todos/:id returns own todos, 404 for foreign or missing", async () => {
  await withApp(async (app) => {
    const alice = await signupToken(app, "alice");
    const bob = await signupToken(app, "bob");
    const todo = await createTodo(app, alice, { title: "mine" });
    const own = await app.inject({
      method: "GET",
      url: `/v1/todos/${todo.id}`,
      headers: auth(alice),
    });
    assert.equal(own.statusCode, 200);
    assert.equal(own.json<TodoBody>().data.todo.title, "mine");
    const foreign = await app.inject({
      method: "GET",
      url: `/v1/todos/${todo.id}`,
      headers: auth(bob),
    });
    assert.equal(foreign.statusCode, 404);
    const missing = await app.inject({
      method: "GET",
      url: "/v1/todos/todo_nope",
      headers: auth(alice),
    });
    assert.equal(missing.statusCode, 404);
  });
});

test("GET /v1/todos filters by tag and done query params", async () => {
  await withApp(async (app) => {
    const token = await signupToken(app, "alice");
    const chores = await createTodo(app, token, { title: "chores", tags: ["home"] });
    await createTodo(app, token, { title: "taxes", tags: ["home", "money"] });
    await createTodo(app, token, { title: "release", tags: ["work"] });
    await app.inject({
      method: "PATCH",
      url: `/v1/todos/${chores.id}`,
      headers: auth(token),
      payload: { done: true, version: 1 },
    });
    const titles = async (qs: string) => {
      const res = await app.inject({ method: "GET", url: `/v1/todos${qs}`, headers: auth(token) });
      assert.equal(res.statusCode, 200, qs);
      return res.json<{ data: { todos: Todo[] } }>().data.todos.map((t) => t.title);
    };
    assert.deepEqual(await titles("?tag=home"), ["chores", "taxes"]);
    assert.deepEqual(await titles("?done=true"), ["chores"]);
    assert.deepEqual(await titles("?tag=home&done=false"), ["taxes"]);
    const bad = await app.inject({
      method: "GET",
      url: "/v1/todos?done=maybe",
      headers: auth(token),
    });
    assert.equal(bad.statusCode, 400);
  });
});

test("tags are normalized on write (trimmed, deduped)", async () => {
  await withApp(async (app) => {
    const token = await signupToken(app, "alice");
    const created = await createTodo(app, token, { title: "x", tags: [" a", "a ", "b"] });
    assert.deepEqual(created.tags, ["a", "b"]);
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/todos/${created.id}`,
      headers: auth(token),
      payload: { tags: ["c", " c "], version: 1 },
    });
    assert.deepEqual(res.json<TodoBody>().data.todo.tags, ["c"]);
  });
});

test("PATCH updates title, done, and tags", async () => {
  await withApp(async (app) => {
    const token = await signupToken(app, "alice");
    const todo = await createTodo(app, token, { title: "before", tags: ["a"] });
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/todos/${todo.id}`,
      headers: auth(token),
      payload: { title: "after", done: true, tags: ["b", "c"], version: 1 },
    });
    assert.equal(res.statusCode, 200);
    const updated = res.json<TodoBody>().data.todo;
    assert.equal(updated.title, "after");
    assert.equal(updated.done, true);
    assert.deepEqual(updated.tags, ["b", "c"]);
  });
});

test("todos of other users look like they don't exist", async () => {
  await withApp(async (app) => {
    const alice = await signupToken(app, "alice");
    const bob = await signupToken(app, "bob");
    const bobsTodo = await createTodo(app, bob, { title: "bob's" });
    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/todos/${bobsTodo.id}`,
      headers: auth(alice),
      payload: { done: true, version: 1 },
    });
    assert.equal(patch.statusCode, 404);
    const del = await app.inject({
      method: "DELETE",
      url: `/v1/todos/${bobsTodo.id}?version=1`,
      headers: auth(alice),
    });
    assert.equal(del.statusCode, 404);
  });
});

test("DELETE removes a todo", async () => {
  await withApp(async (app) => {
    const token = await signupToken(app, "alice");
    const todo = await createTodo(app, token, { title: "temp" });
    const del = await app.inject({
      method: "DELETE",
      url: `/v1/todos/${todo.id}?version=1`,
      headers: auth(token),
    });
    assert.equal(del.statusCode, 204);
    const list = await app.inject({ method: "GET", url: "/v1/todos", headers: auth(token) });
    assert.deepEqual(list.json<{ data: { todos: Todo[] } }>().data.todos, []);
  });
});

test("invalid todo payloads get 400 problem+json", async () => {
  await withApp(async (app) => {
    const token = await signupToken(app, "alice");
    const cases: Record<string, unknown>[] = [{}, { title: "" }, { title: "x", tags: "notag" }];
    for (const payload of cases) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/todos",
        headers: auth(token),
        payload,
      });
      assert.equal(res.statusCode, 400, JSON.stringify(payload));
      assert.match(res.headers["content-type"] ?? "", /^application\/problem\+json/);
    }
  });
});
