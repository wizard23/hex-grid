import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { THEMES } from "./theme";

const css = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf8");
const MARKER = "end of theme tokens";

// the tokens every theme block must (re)define — the theme contract
const COLOR_TOKENS = [
  "--bg",
  "--bg-image",
  "--surface",
  "--surface-alt",
  "--text",
  "--muted",
  "--border",
  "--accent",
  "--accent-contrast",
  "--danger",
  "--shadow",
];

test("styles.css keeps every color literal inside the token blocks", () => {
  const marker = css.indexOf(MARKER);
  assert.ok(marker > 0, "token-end marker comment is present");
  const rules = css.slice(marker);
  const literals = rules.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) ?? [];
  assert.deepEqual(literals, [], "color literals outside the token blocks — use var(--…)");
});

test("every theme defines the full token contract", () => {
  for (const { id } of THEMES) {
    const selector = id === "dark" ? ":root {" : `:root[data-theme="${id}"]`;
    const start = css.indexOf(selector);
    assert.ok(start >= 0, `token block for "${id}" exists`);
    const block = css.slice(start, css.indexOf("}", start));
    for (const token of COLOR_TOKENS) {
      assert.ok(block.includes(`${token}:`), `theme "${id}" defines ${token}`);
    }
  }
});
