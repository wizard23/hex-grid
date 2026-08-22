import { matchesTodoFilter, type Todo, type TodoFilter, type User } from "@asimov/shared";
import { createStore, type Store } from "@asimov/server/store";
import { resolveDataDir } from "@asimov/server/workspace";

// users.json records carry a passwordHash the CLI never reads or prints
type UserRecord = User & { passwordHash?: string };

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

export interface Stores {
  users: Store<UserRecord>;
  todos: Store<Todo>;
}

// same resolver as the server, so the two can never point at different data
export function defaultDataDir(): string {
  return resolveDataDir();
}

export async function openStores(dataDir: string): Promise<Stores> {
  return {
    users: await createStore<UserRecord>(dataDir, "users"),
    todos: await createStore<Todo>(dataDir, "todos"),
  };
}

function toPublicUser(record: UserRecord): User {
  const user: User = {
    id: record.id,
    username: record.username,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    version: record.version,
  };
  if (record.email !== undefined) user.email = record.email;
  return user;
}

function requireUser(stores: Stores, username: string): UserRecord {
  const record = stores.users.values().find((u) => u.username === username);
  if (!record) throw new CliError(`no user "${username}"`);
  return record;
}

export function listUsers(stores: Stores): User[] {
  return stores.users
    .values()
    .map(toPublicUser)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function findTodos(stores: Stores, username: string, filter: TodoFilter = {}): Todo[] {
  const user = requireUser(stores, username);
  return stores.todos
    .values()
    .filter((t) => t.ownerId === user.id && matchesTodoFilter(t, filter))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function removeUser(
  stores: Stores,
  username: string,
): Promise<{ user: User; removedTodos: number }> {
  const record = requireUser(stores, username);
  const owned = stores.todos.values().filter((t) => t.ownerId === record.id);
  for (const todo of owned) await stores.todos.delete(todo.id);
  await stores.users.delete(record.id);
  return { user: toPublicUser(record), removedTodos: owned.length };
}
