import { existsSync } from "node:fs";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { Ajv } from "ajv";
// ajv-formats is CJS-only; under NodeNext the callable plugin sits on .default
import ajvFormats from "ajv-formats";
const addFormats = ajvFormats.default;
import type { Todo } from "@asimov/shared";
import { registerAuthRoutes, type UserRecord } from "./auth/routes.js";
import type { AppConfig } from "./config.js";
import { registerTodoRoutes } from "./todos/routes.js";
import { errorHandler, notFoundHandler, Problem } from "./lib/problem.js";
import { createStore } from "./lib/store.js";

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.logger });

  const ajv = new Ajv({
    coerceTypes: true,
    useDefaults: true,
    removeAdditional: true,
    allErrors: false,
  });
  addFormats(ajv);
  app.setValidatorCompiler(({ schema }) => ajv.compile(schema));

  app.setErrorHandler(errorHandler);

  // in production the built web app is served from here; in dev vite serves
  // it and proxies /v1 to this server
  if (config.webDist !== undefined && existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/v1")) {
        void reply.sendFile("index.html");
        return;
      }
      notFoundHandler(request, reply);
    });
  } else {
    app.setNotFoundHandler(notFoundHandler);
  }

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: { title: "Asimov Todo API", version: "0.0.0" },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  await app.register(fastifyJwt, {
    secret: config.jwtSecret,
    sign: { expiresIn: config.tokenTtl },
  });
  app.decorate("authenticate", async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      throw new Problem(401, "Unauthorized", "missing or invalid bearer token");
    }
  });

  const users = await createStore<UserRecord>(config.dataDir, "users");
  const todos = await createStore<Todo>(config.dataDir, "todos");
  registerAuthRoutes(app, users, todos);
  registerTodoRoutes(app, todos);

  app.get("/healthz", {
    schema: {
      response: {
        200: {
          type: "object",
          required: ["data"],
          properties: {
            data: {
              type: "object",
              required: ["status"],
              properties: { status: { type: "string" } },
            },
          },
        },
      },
    },
  }, () => ({ data: { status: "ok" } }));

  app.get("/openapi.json", { schema: { hide: true } }, () => app.swagger());

  return app;
}
