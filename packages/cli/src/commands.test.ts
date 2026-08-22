import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliError, findTodos, listUsers, openStores, removeUser, type Stores } from "./commands.js";

async function seededStores(): Promise<{ stores: Stores; dataDir: string }> {
  const dataDir = await mkdtemp(join(tmpdir(), "minimal-cli-"));
  const stores = await openStores(dataDir);
  await stores.users.set("usr_a", {
    id: "usr_a",
    username: "alice",
    email: "alice@example.com",
    createdAt: "2026-07-15T10:00:00.000Z",
    updatedAt: "2026-07-15T10:00:00.000Z",
    version: 1,
    passwordHash: "scrypt:aa:bb",
  });
  await stores.users.set("usr_b", {
    id: "usr_b",
    username: "bob",
    createdAt: "2026-07-15T11:00:00.000Z",
    updatedAt: "2026-07-15T11:00:00.000Z",
    version: 1,
    passwordHash: "scrypt:cc:dd",
  });
  const todo = (id: string, ownerId: string, title: string, done: boolean, tags: string[]) => ({
    id,
    ownerId,
    title,
    done,
    tags,
    createdAt: `2026-07-15T12:00:0${id.slice(-1)}.000Z`,
    updatedAt: `2026-07-15T12:00:0${id.slice(-1)}.000Z`,
    version: 1,
  });
  await stores.todos.set("todo_1", todo("todo_1", "usr_a", "water plants", false, ["home"]));
  await stores.todos.set("todo_2", todo("todo_2", "usr_a", "file taxes", true, ["home", "money"]));
  await stores.todos.set("todo_3", todo("todo_3", "usr_a", "ship release", false, ["work"]));
  await stores.todos.set("todo_4", todo("todo_4", "usr_b", "bob's todo", false, ["work"]));
  return { stores, dataDir };
}

test("listUsers returns all users without password material", async () => {
  const { stores, dataDir } = await seededStores();
  try {
    const users = listUsers(stores);
    assert.deepEqual(
      users.map((u) => u.username),
      ["alice", "bob"],
    );
    assert.equal(users[0]?.email, "alice@example.com");
    assert.ok(!JSON.stringify(users).includes("scrypt"), "no password material");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("findTodos scopes to the user and applies tag/done filters", async () => {
  const { stores, dataDir } = await seededStores();
  try {
    assert.equal(findTodos(stores, "alice").length, 3);
    assert.deepEqual(
      findTodos(stores, "alice", { tag: "home" }).map((t) => t.title),
      ["water plants", "file taxes"],
    );
    assert.deepEqual(
      findTodos(stores, "alice", { done: false }).map((t) => t.title),
      ["water plants", "ship release"],
    );
    assert.deepEqual(
      findTodos(stores, "alice", { tag: "home", done: true }).map((t) => t.title),
      ["file taxes"],
    );
    assert.deepEqual(
      findTodos(stores, "bob").map((t) => t.title),
      ["bob's todo"],
    );
    assert.throws(() => findTodos(stores, "nobody"), CliError);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("removeUser cascades to the user's todos and persists", async () => {
  const { stores, dataDir } = await seededStores();
  try {
    const result = await removeUser(stores, "alice");
    assert.equal(result.user.username, "alice");
    assert.equal(result.removedTodos, 3);
    const reopened = await openStores(dataDir);
    assert.deepEqual(
      listUsers(reopened).map((u) => u.username),
      ["bob"],
    );
    assert.equal(reopened.todos.values().length, 1);
    await assert.rejects(removeUser(stores, "alice"), CliError);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
