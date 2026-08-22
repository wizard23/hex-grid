// Headless-browser e2e: boots the built server (ephemeral port, temp data
// dir) and drives the real UI. On-demand deep verification — not part of the
// required gate order. Prereqs: `npm run build` and, once,
// `npx playwright install chromium`.
import { spawn } from "node:child_process";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));

for (const required of ["packages/server/dist/main.js", "packages/web/dist/index.html"]) {
  try {
    await access(join(root, required));
  } catch {
    console.error(`missing ${required} — run \`npm run build\` first`);
    process.exit(1);
  }
}

const dataDir = await mkdtemp(join(tmpdir(), "minimal-e2e-"));
const server = spawn("node", ["dist/main.js"], {
  cwd: join(root, "packages/server"),
  env: { ...process.env, PORT: "0", DATA_DIR: dataDir, HOST: "127.0.0.1" },
});

const base = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("server did not start within 10s")), 10_000);
  let out = "";
  server.stdout.on("data", (chunk) => {
    out += String(chunk);
    const match = /API docs at (http:\/\/[^\s"\\]+)\/docs/.exec(out);
    if (match) {
      clearTimeout(timer);
      resolve(match[1]);
    }
  });
  server.on("exit", (code) => {
    clearTimeout(timer);
    reject(new Error(`server exited early (code ${code})`));
  });
});

let browser;
let failed = false;
const ok = (name, cond) => {
  console.log(`${cond ? "✔" : "✘"} ${name}`);
  if (!cond) failed = true;
};

try {
  browser = await chromium.launch();

  // two contexts = two tabs with independent sessionStorage
  const tabA = await (await browser.newContext()).newPage();
  const tabB = await (await browser.newContext()).newPage();

  async function signup(page, username) {
    await page.goto(base);
    await page.getByRole("button", { name: "Sign up" }).click();
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password", { exact: true }).fill("hunter2hunter2");
    // double-typed password: mismatch must block the submit
    await page.getByLabel("Repeat password").fill("different-pw");
    ok(`${username}: mismatch warning shown`, await page.getByText("Passwords don't match.").isVisible());
    ok(
      `${username}: submit blocked on mismatch`,
      await page.getByRole("button", { name: "Create account" }).isDisabled(),
    );
    await page.getByLabel("Repeat password").fill("hunter2hunter2");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByPlaceholder("What needs doing?").waitFor();
    ok(`${username}: logged in after signup`, await page.getByText(username).first().isVisible());
  }

  async function addTodo(page, title, tags) {
    await page.getByPlaceholder("What needs doing?").fill(title);
    if (tags) await page.getByPlaceholder("tags, comma, separated").fill(tags);
    await page.getByRole("button", { name: "Add" }).click();
    await page.getByText(title).waitFor();
  }

  await signup(tabA, "browser-alice");
  await signup(tabB, "browser-bob");

  await addTodo(tabA, "water plants", "home, garden");
  await addTodo(tabA, "file taxes", "home");
  await addTodo(tabB, "ship release", "work");

  ok("tab A sees own todos", await tabA.getByText("water plants").isVisible());
  ok("tab A does not see tab B's todo", !(await tabA.getByText("ship release").isVisible()));
  ok("tab B does not see tab A's todo", !(await tabB.getByText("water plants").isVisible()));

  // tag chips + filter
  ok("tag chip rendered", await tabA.getByRole("button", { name: "#garden" }).isVisible());
  await tabA.getByRole("button", { name: "#garden" }).click();
  await tabA.getByText("Showing").waitFor();
  ok("filter hides non-matching", !(await tabA.getByText("file taxes").isVisible()));
  ok("filter keeps matching", await tabA.getByText("water plants").isVisible());
  await tabA.getByRole("button", { name: "clear" }).click();
  ok("clear restores list", await tabA.getByText("file taxes").isVisible());

  // toggle + delete
  await tabA.getByLabel("Done: water plants").check();
  ok(
    "toggle marks done",
    (await tabA.locator("li.done .title").first().textContent()) === "water plants",
  );
  await tabA.getByLabel("Delete: file taxes").click();
  await tabA.getByText("file taxes").waitFor({ state: "detached" });
  ok("delete removes todo", !(await tabA.getByText("file taxes").isVisible()));

  // per-tab session survives reload
  await tabA.reload();
  await tabA.getByText("water plants").waitFor();
  ok("session survives reload", await tabA.getByText("browser-alice").first().isVisible());
  ok("done state persisted", (await tabA.locator("li.done .title").count()) === 1);

  // login flow: fresh context, wrong password then right one
  const tabC = await (await browser.newContext()).newPage();
  await tabC.goto(base);
  await tabC.getByLabel("Username").fill("browser-alice");
  await tabC.getByLabel("Password", { exact: true }).fill("wrong-password");
  await tabC.locator('button[type="submit"]').click();
  await tabC.getByText("invalid username or password").waitFor();
  ok("wrong password shows API error", true);
  await tabC.getByLabel("Password", { exact: true }).fill("hunter2hunter2");
  await tabC.locator('button[type="submit"]').click();
  await tabC.getByText("water plants").waitFor();
  ok("login shows existing todos", true);

  // optimistic concurrency: tab A edits, tab C still holds the old version
  await tabA.getByLabel("Done: water plants").uncheck();
  await tabC.getByLabel("Done: water plants").click();
  await tabC.getByText("changed in another tab").waitFor();
  ok("stale write from another tab gets the conflict notice", true);
  await tabC.getByText("water plants").waitFor();
  await tabC.getByLabel("Done: water plants").check();
  await tabC.locator("li.done .title").first().waitFor();
  ok("retry after the conflict reload succeeds", true);

  // menu bar navigation + Settings > Appearance (theme lives here now)
  const activeTheme = () => tabA.evaluate(() => document.documentElement.dataset.theme);
  ok("default theme is dark", (await activeTheme()) === "dark");
  await tabA.getByRole("button", { name: "Settings" }).click();
  await tabA.getByLabel("Theme").selectOption("northern-lights");
  ok("theme switch applies", (await activeTheme()) === "northern-lights");

  // Settings > Profile: edit email (PATCH /v1/me end to end)
  await tabA.getByLabel(/Email/).fill("alice@example.com");
  await tabA.getByRole("button", { name: "Save changes" }).click();
  await tabA.getByText("Saved.").waitFor();
  ok("profile email saved", true);

  await tabA.getByRole("button", { name: "Todos" }).click();
  ok("nav back to todos", await tabA.getByPlaceholder("What needs doing?").isVisible());

  await tabA.reload();
  await tabA.getByPlaceholder("What needs doing?").waitFor();
  ok("theme persists across reload", (await activeTheme()) === "northern-lights");

  // logout
  await tabC.getByRole("button", { name: "Log out" }).click();
  await tabC.getByLabel("Username").waitFor();
  ok("logout returns to auth screen", true);
  ok("menu shows Sign up when logged out", await tabC.getByRole("button", { name: "Sign up" }).isVisible());
} catch (err) {
  failed = true;
  console.error(err instanceof Error ? err.message : err);
  if (String(err).includes("Executable doesn't exist")) {
    console.error("hint: npx playwright install chromium");
  }
} finally {
  await browser?.close();
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
}

console.log(failed ? "FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
