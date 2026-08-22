import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { PASSWORD_MIN_LENGTH, USERNAME_PATTERN, type Todo, type User } from "@asimov/shared";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { Problem } from "../lib/problem.js";
import type { Store } from "../lib/store.js";
import { assertVersion } from "../lib/versioning.js";

export interface UserRecord extends User {
  passwordHash: string;
}

interface SignupBody {
  username: string;
  password: string;
  email?: string;
}

interface LoginBody {
  username: string;
  password: string;
}

interface UpdateMeBody {
  email?: string;
  password?: string;
  version: number;
}

const userSchema = {
  type: "object",
  required: ["id", "username", "createdAt", "updatedAt", "version"],
  properties: {
    id: { type: "string" },
    username: { type: "string" },
    email: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    version: { type: "integer", minimum: 1 },
  },
} as const;

const authResponseSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["user", "token"],
      properties: { user: userSchema, token: { type: "string" } },
    },
  },
} as const;

const credentialProperties = {
  username: { type: "string", pattern: USERNAME_PATTERN },
  password: { type: "string", minLength: PASSWORD_MIN_LENGTH },
} as const;

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

function findByUsername(users: Store<UserRecord>, username: string): UserRecord | undefined {
  return users.values().find((u) => u.username === username);
}

export function registerAuthRoutes(
  app: FastifyInstance,
  users: Store<UserRecord>,
  todos: Store<Todo>, // for the account-delete cascade
): void {
  app.post<{ Body: SignupBody }>("/v1/auth/signup", {
    schema: {
      tags: ["auth"],
      body: {
        type: "object",
        additionalProperties: false,
        required: ["username", "password"],
        properties: {
          ...credentialProperties,
          email: { type: "string", format: "email" },
        },
      },
      response: { 201: authResponseSchema },
    },
  }, async (request, reply) => {
    const { username, password, email } = request.body;
    if (findByUsername(users, username)) {
      throw new Problem(409, "Conflict", `username "${username}" is already taken`);
    }
    const now = new Date().toISOString();
    const record: UserRecord = {
      id: `usr_${randomUUID()}`,
      username,
      createdAt: now,
      updatedAt: now,
      version: 1,
      passwordHash: await hashPassword(password),
    };
    if (email !== undefined) record.email = email;
    await users.set(record.id, record);
    const token = app.jwt.sign({ sub: record.id, username });
    void reply.status(201);
    return { data: { user: toPublicUser(record), token } };
  });

  app.post<{ Body: LoginBody }>("/v1/auth/login", {
    schema: {
      tags: ["auth"],
      body: {
        type: "object",
        additionalProperties: false,
        required: ["username", "password"],
        properties: credentialProperties,
      },
      response: { 200: authResponseSchema },
    },
  }, async (request) => {
    const { username, password } = request.body;
    const record = findByUsername(users, username);
    // same work and same response whether the user exists or not
    const ok = await verifyPassword(password, record?.passwordHash ?? DUMMY_HASH);
    if (!record || !ok) {
      throw new Problem(401, "Unauthorized", "invalid username or password");
    }
    const token = app.jwt.sign({ sub: record.id, username });
    return { data: { user: toPublicUser(record), token } };
  });

  app.get("/v1/me", {
    onRequest: [app.authenticate],
    schema: {
      tags: ["auth"],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: "object",
          required: ["data"],
          properties: {
            data: {
              type: "object",
              required: ["user"],
              properties: { user: userSchema },
            },
          },
        },
      },
    },
  }, (request) => {
    const record = users.get(request.user.sub);
    if (!record) throw new Problem(401, "Unauthorized", "account no longer exists");
    return { data: { user: toPublicUser(record) } };
  });

  function requireAccount(id: string): UserRecord {
    const record = users.get(id);
    if (!record) throw new Problem(401, "Unauthorized", "account no longer exists");
    return record;
  }

  app.patch<{ Body: UpdateMeBody }>("/v1/me", {
    onRequest: [app.authenticate],
    schema: {
      tags: ["auth"],
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        additionalProperties: false,
        required: ["version"],
        minProperties: 2, // version + at least one change
        properties: {
          // a valid email, or "" to clear it
          email: { anyOf: [{ type: "string", format: "email" }, { type: "string", maxLength: 0 }] },
          password: { type: "string", minLength: PASSWORD_MIN_LENGTH },
          version: { type: "integer", minimum: 1 },
        },
      },
      response: {
        200: {
          type: "object",
          required: ["data"],
          properties: {
            data: { type: "object", required: ["user"], properties: { user: userSchema } },
          },
        },
      },
    },
  }, async (request) => {
    const record = assertVersion(requireAccount(request.user.sub), request.body.version, "profile");
    const { email, password } = request.body;
    const updated: UserRecord = {
      ...record,
      updatedAt: new Date().toISOString(),
      version: record.version + 1,
    };
    if (email !== undefined) {
      if (email === "") delete updated.email;
      else updated.email = email;
    }
    if (password !== undefined) updated.passwordHash = await hashPassword(password);
    await users.set(updated.id, updated);
    return { data: { user: toPublicUser(updated) } };
  });

  app.delete<{ Querystring: { version: number } }>("/v1/me", {
    onRequest: [app.authenticate],
    schema: {
      tags: ["auth"],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        additionalProperties: false,
        required: ["version"],
        properties: { version: { type: "integer", minimum: 1 } },
      },
      response: { 204: { type: "null" } },
    },
  }, async (request, reply) => {
    const record = assertVersion(requireAccount(request.user.sub), request.query.version, "profile");
    for (const todo of todos.values()) {
      if (todo.ownerId === record.id) await todos.delete(todo.id);
    }
    await users.delete(record.id);
    void reply.status(204);
  });
}

// valid hash of an unguessable value; login verifies against it for unknown
// users so response timing does not reveal whether a username exists
const DUMMY_HASH =
  "scrypt:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000";
