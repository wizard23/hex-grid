import { parseArgs } from "node:util";
import type { Todo, TodoFilter, User } from "@asimov/shared";
import {
  CliError,
  defaultDataDir,
  findTodos,
  listUsers,
  openStores,
  removeUser,
} from "./commands.js";

const USAGE = `asimov — admin CLI for the todo server's data files

Usage:
  asimov users                                   list all users
  asimov todos <username> [--tag <tag>] [--done | --open]
                                                 list a user's todos, filtered
  asimov remove-user <username>                  delete a user AND their todos

Options:
  --data-dir <dir>   data directory (default: $DATA_DIR, or <workspace root>/data)
  -h, --help         show this help

Note: the server keeps data in memory — stop it before remove-user
(or restart it afterwards), or it may overwrite the change.`;

function fmtUser(u: User): string {
  return [u.id, u.username, u.email ?? "-", u.createdAt].join("  ");
}

function fmtTodo(t: Todo): string {
  const tags = t.tags.map((tag) => `#${tag}`).join(" ");
  return [`[${t.done ? "x" : " "}]`, t.title, tags, `(${t.id})`].filter(Boolean).join("  ");
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      tag: { type: "string" },
      done: { type: "boolean" },
      open: { type: "boolean" },
      "data-dir": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  const [command, username] = positionals;
  if (values.help === true || command === undefined) {
    console.log(USAGE);
    return command === undefined && values.help !== true ? 1 : 0;
  }
  if (values.done === true && values.open === true) {
    throw new CliError("--done and --open are mutually exclusive");
  }

  const stores = await openStores(values["data-dir"] ?? defaultDataDir());

  switch (command) {
    case "users": {
      const users = listUsers(stores);
      if (users.length === 0) console.log("no users yet");
      for (const user of users) console.log(fmtUser(user));
      return 0;
    }
    case "todos": {
      if (username === undefined) throw new CliError("usage: asimov todos <username> [--tag <tag>] [--done | --open]");
      const filter: TodoFilter = {};
      if (values.tag !== undefined) filter.tag = values.tag;
      if (values.done === true) filter.done = true;
      if (values.open === true) filter.done = false;
      const todos = findTodos(stores, username, filter);
      if (todos.length === 0) console.log("no matching todos");
      for (const todo of todos) console.log(fmtTodo(todo));
      return 0;
    }
    case "remove-user": {
      if (username === undefined) throw new CliError("usage: asimov remove-user <username>");
      const { user, removedTodos } = await removeUser(stores, username);
      console.log(`removed user ${user.username} (${user.id}) and ${removedTodos} todo(s)`);
      return 0;
    }
    default:
      throw new CliError(`unknown command "${command}"\n\n${USAGE}`);
  }
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error(err instanceof CliError ? err.message : err);
  process.exitCode = 1;
}
