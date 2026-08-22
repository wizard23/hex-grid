import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface RootManifest {
  workspaces?: unknown;
  config?: { dataDir?: unknown };
}

function readManifest(dir: string): RootManifest | null {
  const file = join(dir, "package.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as RootManifest;
}

/**
 * Walk up to the package.json that declares "workspaces" — the one
 * unambiguous marker of an npm-workspace root. Deterministic: no cwd,
 * no heuristics; the default start is this file's own location.
 */
export function findWorkspaceRoot(
  startDir: string = fileURLToPath(new URL(".", import.meta.url)),
): string {
  let dir = resolve(startDir);
  for (;;) {
    if (readManifest(dir)?.workspaces !== undefined) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        'not inside an npm workspace (no package.json with "workspaces" above ' +
          `${startDir}) — set DATA_DIR explicitly`,
      );
    }
    dir = parent;
  }
}

/**
 * Where the JSON data files live. Precedence:
 * 1. DATA_DIR env (resolved against cwd, as the shell user typed it)
 * 2. "config": { "dataDir": ... } in the root package.json, relative to the root
 * 3. "data" under the workspace root
 */
export function resolveDataDir(
  env: Record<string, string | undefined> = process.env,
  startDir?: string,
): string {
  const fromEnv = env.DATA_DIR;
  if (fromEnv !== undefined && fromEnv !== "") return resolve(fromEnv);
  const root = findWorkspaceRoot(startDir);
  const configured = readManifest(root)?.config?.dataDir;
  return resolve(root, typeof configured === "string" ? configured : "data");
}
