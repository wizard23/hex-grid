import { fileURLToPath } from "node:url";
import { resolveDataDir } from "./lib/workspace.js";

export interface AppConfig {
  port: number;
  host: string;
  jwtSecret: string;
  /** token lifetime, e.g. "7d", "12h" */
  tokenTtl: string;
  dataDir: string;
  /** directory with the built web app; served when it exists */
  webDist?: string;
  logger: boolean;
}

export function envConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? process.env.API_PORT ?? 3939),
    host: process.env.HOST ?? "127.0.0.1",
    jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
    tokenTtl: process.env.TOKEN_TTL ?? "7d",
    dataDir: resolveDataDir(),
    webDist: fileURLToPath(new URL("../../web/dist", import.meta.url)),
    logger: true,
  };
}
