import test from "node:test";
import assert from "node:assert/strict";

// node has no sessionStorage; a Map-backed stand-in is enough for api.ts
const storage = new Map<string, string>();
(globalThis as { sessionStorage?: unknown }).sessionStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
};

const api = await import("./api");

interface RecordedCall {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: string;
}

function stubFetch(status: number, body: unknown): RecordedCall[] {
  const calls: RecordedCall[] = [];
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      ...(init?.method !== undefined ? { method: init.method } : {}),
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    });
    const payload = status === 204 ? null : JSON.stringify(body);
    return Promise.resolve(new Response(payload, { status, statusText: "Stub Status" }));
  };
  return calls;
}

test("setToken/getToken round-trip; null clears (per-tab session storage)", () => {
  api.setToken("t-123");
  assert.equal(api.getToken(), "t-123");
  api.setToken(null);
  assert.equal(api.getToken(), null);
});

test("login POSTs JSON and unwraps the {data} envelope", async () => {
  api.setToken(null);
  const calls = stubFetch(200, { data: { user: { username: "alice" }, token: "tok" } });
  const { user, token } = await api.login({ username: "alice", password: "hunter2hunter2" });
  assert.equal(user.username, "alice");
  assert.equal(token, "tok");
  assert.deepEqual(calls[0]?.method, "POST");
  assert.equal(calls[0]?.url, "/v1/auth/login");
  assert.equal(calls[0]?.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0]?.body ?? ""), {
    username: "alice",
    password: "hunter2hunter2",
  });
  assert.equal(calls[0]?.headers.authorization, undefined);
});

test("requests carry the Bearer token when one is stored", async () => {
  api.setToken("tok-1");
  const calls = stubFetch(200, { data: { todos: [] } });
  await api.listTodos();
  assert.equal(calls[0]?.headers.authorization, "Bearer tok-1");
  assert.equal(calls[0]?.headers["content-type"], undefined, "no content-type without a body");
});

test("problem+json becomes an ApiError with status and detail", async () => {
  api.setToken(null);
  stubFetch(409, { title: "Conflict", status: 409, detail: "username \"alice\" is already taken" });
  await assert.rejects(
    api.signup({ username: "alice", password: "hunter2hunter2" }),
    (err: unknown) => {
      assert.ok(err instanceof api.ApiError);
      assert.equal(err.status, 409);
      assert.equal(err.message, 'username "alice" is already taken');
      return true;
    },
  );
});

test("ApiError falls back to title, then statusText", async () => {
  api.setToken(null);
  stubFetch(401, { title: "Unauthorized" });
  await assert.rejects(api.me(), (err: unknown) => {
    assert.ok(err instanceof api.ApiError);
    assert.equal(err.message, "Unauthorized");
    return true;
  });
  stubFetch(500, {});
  await assert.rejects(api.me(), (err: unknown) => {
    assert.ok(err instanceof api.ApiError);
    assert.equal(err.message, "Stub Status");
    return true;
  });
});

test("204 responses resolve without reading a body; version travels as a query param", async () => {
  api.setToken("tok-1");
  const calls = stubFetch(204, undefined);
  assert.equal(await api.deleteTodo("todo_1", 3), undefined);
  assert.equal(calls[0]?.url, "/v1/todos/todo_1?version=3");
});
