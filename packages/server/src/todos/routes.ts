import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { matchesTodoFilter, normalizeTags, type Todo, type TodoFilter } from "@asimov/shared";
import { Problem } from "../lib/problem.js";
import type { Store } from "../lib/store.js";
import { assertVersion } from "../lib/versioning.js";

const todoSchema = {
  type: "object",
  required: ["id", "ownerId", "title", "done", "tags", "createdAt", "updatedAt", "version"],
  properties: {
    id: { type: "string" },
    ownerId: { type: "string" },
    title: { type: "string" },
    done: { type: "boolean" },
    tags: { type: "array", items: { type: "string" } },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    version: { type: "integer", minimum: 1 },
  },
} as const;

const todoResponseSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["todo"],
      properties: { todo: todoSchema },
    },
  },
} as const;

const titleSchema = { type: "string", minLength: 1, maxLength: 200 } as const;
const tagsSchema = {
  type: "array",
  items: { type: "string", minLength: 1, maxLength: 30 },
} as const;
const versionSchema = { type: "integer", minimum: 1 } as const;

const paramsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } },
} as const;

interface TodoParams {
  id: string;
}

export function registerTodoRoutes(app: FastifyInstance, todos: Store<Todo>): void {
  const security = [{ bearerAuth: [] }];

  function ownTodo(id: string, ownerId: string): Todo {
    const todo = todos.get(id);
    if (!todo || todo.ownerId !== ownerId) {
      throw new Problem(404, "Not Found", `no todo "${id}"`);
    }
    return todo;
  }

  app.get<{ Querystring: TodoFilter }>("/v1/todos", {
    onRequest: [app.authenticate],
    schema: {
      tags: ["todos"],
      security,
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          tag: { type: "string", minLength: 1 },
          done: { type: "boolean" },
        },
      },
      response: {
        200: {
          type: "object",
          required: ["data"],
          properties: {
            data: {
              type: "object",
              required: ["todos"],
              properties: { todos: { type: "array", items: todoSchema } },
            },
          },
        },
      },
    },
  }, (request) => {
    const mine = todos
      .values()
      .filter((t) => t.ownerId === request.user.sub && matchesTodoFilter(t, request.query))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { data: { todos: mine } };
  });

  app.get<{ Params: TodoParams }>("/v1/todos/:id", {
    onRequest: [app.authenticate],
    schema: {
      tags: ["todos"],
      security,
      params: paramsSchema,
      response: { 200: todoResponseSchema },
    },
  }, (request) => {
    return { data: { todo: ownTodo(request.params.id, request.user.sub) } };
  });

  app.post<{ Body: { title: string; tags?: string[] } }>("/v1/todos", {
    onRequest: [app.authenticate],
    schema: {
      tags: ["todos"],
      security,
      body: {
        type: "object",
        additionalProperties: false,
        required: ["title"],
        properties: { title: titleSchema, tags: tagsSchema },
      },
      response: { 201: todoResponseSchema },
    },
  }, async (request, reply) => {
    const now = new Date().toISOString();
    const todo: Todo = {
      id: `todo_${randomUUID()}`,
      ownerId: request.user.sub,
      title: request.body.title,
      done: false,
      tags: normalizeTags(request.body.tags ?? []),
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await todos.set(todo.id, todo);
    void reply.status(201);
    return { data: { todo } };
  });

  app.patch<{
    Body: { title?: string; done?: boolean; tags?: string[]; version: number };
    Params: TodoParams;
  }>(
    "/v1/todos/:id",
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ["todos"],
        security,
        params: paramsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["version"],
          minProperties: 2,
          properties: {
            title: titleSchema,
            done: { type: "boolean" },
            tags: tagsSchema,
            version: versionSchema,
          },
        },
        response: { 200: todoResponseSchema },
      },
    },
    async (request) => {
      const todo = assertVersion(
        ownTodo(request.params.id, request.user.sub),
        request.body.version,
        "todo",
      );
      const { title, done, tags } = request.body;
      const updated: Todo = {
        ...todo,
        title: title ?? todo.title,
        done: done ?? todo.done,
        tags: tags !== undefined ? normalizeTags(tags) : todo.tags,
        updatedAt: new Date().toISOString(),
        version: todo.version + 1,
      };
      await todos.set(updated.id, updated);
      return { data: { todo: updated } };
    },
  );

  app.delete<{ Params: TodoParams; Querystring: { version: number } }>("/v1/todos/:id", {
    onRequest: [app.authenticate],
    schema: {
      tags: ["todos"],
      security,
      params: paramsSchema,
      querystring: {
        type: "object",
        additionalProperties: false,
        required: ["version"],
        properties: { version: versionSchema },
      },
      response: { 204: { type: "null" } },
    },
  }, async (request, reply) => {
    const todo = assertVersion(
      ownTodo(request.params.id, request.user.sub),
      request.query.version,
      "todo",
    );
    await todos.delete(todo.id);
    void reply.status(204);
  });
}
