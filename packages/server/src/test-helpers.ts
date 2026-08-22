import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import type { AppConfig } from "./config.js";

export function testConfig(dataDir: string): AppConfig {
  return {
    port: 0,
    host: "127.0.0.1",
    jwtSecret: "test-secret",
    tokenTtl: "10m",
    dataDir,
    logger: false,
  };
}

export interface TestApp {
  app: FastifyInstance;
  dataDir: string;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const dataDir = await mkdtemp(join(tmpdir(), "minimal-server-"));
  const app = await buildApp(testConfig(dataDir));
  return {
    app,
    dataDir,
    close: async () => {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
