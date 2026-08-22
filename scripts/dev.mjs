// Dev launcher for `npm run dev:app`.
//
// Vite reads vite.config.ts ONCE at startup and wires its /v1 proxy target
// then — so the API port must be known before vite boots. We therefore pick
// the port up front (here), not after the server binds, and hand it to both
// children via env. No port file, no polling, no race.
//
// Prefer the configured port (API_PORT or 3939); if it's taken, fall back to
// an OS-assigned free one so a sibling project or a stray dev server never
// crashes the launch. The chosen port is forced onto BOTH children (PORT +
// API_PORT), so the server always binds exactly what vite proxies to.
import net from "node:net";
import { spawn } from "node:child_process";

const PREFERRED = Number(process.env.API_PORT ?? 3939);

function isFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

function anyFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const apiPort = (await isFree(PREFERRED)) ? PREFERRED : await anyFreePort();
console.log(
  apiPort === PREFERRED
    ? `[dev] API on ${apiPort}`
    : `[dev] port ${PREFERRED} is taken — API on ${apiPort} instead`,
);

const env = { ...process.env, PORT: String(apiPort), API_PORT: String(apiPort) };
// detached: each child leads its own process group, so we can kill the WHOLE
// tree (npm + the tsx/vite grandchildren it spawns) — npm does not forward
// signals to grandchildren, which would otherwise leave orphans on the ports.
const children = [
  spawn("npm", ["run", "--workspace", "@asimov/server", "dev"], { stdio: "inherit", env, detached: true }),
  spawn("npm", ["run", "dev:web"], { stdio: "inherit", env, detached: true }),
];

let closing = false;
function shutdown(code) {
  if (closing) return;
  closing = true;
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM"); // negative pid = the child's whole group
    } catch {
      // already gone
    }
  }
  process.exit(code);
}

for (const child of children) {
  child.on("exit", (code) => shutdown(code ?? 0)); // -s first: first to exit ends the run
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
