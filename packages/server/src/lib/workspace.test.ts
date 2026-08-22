import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findWorkspaceRoot, resolveDataDir } from "./workspace.js";

async function makeTree(rootManifest: object): Promise<{ root: string; leaf: string }> {
  const root = await mkdtemp(join(tmpdir(), "ws-"));
  await writeFile(join(root, "package.json"), JSON.stringify(rootManifest));
  const leaf = join(root, "packages", "server", "src");
  await mkdir(leaf, { recursive: true });
  // a package manifest WITHOUT "workspaces" must not stop the walk
  await writeFile(
    join(root, "packages", "server", "package.json"),
    JSON.stringify({ name: "x" }),
  );
  return { root, leaf };
}

test("findWorkspaceRoot walks past package.jsons without a workspaces field", async () => {
  const { root, leaf } = await makeTree({ workspaces: ["packages/*"] });
  try {
    assert.equal(findWorkspaceRoot(leaf), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveDataDir: DATA_DIR env wins and resolves like the shell would", async () => {
  const { leaf, root } = await makeTree({ workspaces: [] });
  try {
    assert.equal(resolveDataDir({ DATA_DIR: "/abs/state" }, leaf), resolve("/abs/state"));
    assert.equal(resolveDataDir({ DATA_DIR: "rel-state" }, leaf), resolve("rel-state"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveDataDir: root package.json config.dataDir, relative to the root", async () => {
  const { root, leaf } = await makeTree({ workspaces: [], config: { dataDir: "state" } });
  try {
    assert.equal(resolveDataDir({}, leaf), join(root, "state"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveDataDir defaults to <workspace root>/data", async () => {
  const { root, leaf } = await makeTree({ workspaces: [] });
  try {
    assert.equal(resolveDataDir({}, leaf), join(root, "data"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("this repo resolves to <repo root>/data by default", () => {
  const dir = resolveDataDir({});
  assert.ok(dir.endsWith("/data"), dir);
  assert.ok(!dir.includes("packages"), `server-package-local path: ${dir}`);
});
