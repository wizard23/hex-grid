#!/usr/bin/env bash
# Smoke test for copy.sh: the copied project must pass all gates on its own.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "$script_dir/.." && pwd)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

"$root_dir/scripts/copy.sh" "$tmp/project" >/dev/null
echo "copied to $tmp/project"

# the copy must contain the load-bearing files ...
for must in AGENTS.md eslint.config.js tsconfig.json tsconfig.dev.json tsconfig.base.json \
            package-lock.json packages/shared/src/index.ts scripts/copy.sh \
            .github/workflows/ci.yml .gitignore; do
  if [[ ! -f "$tmp/project/$must" ]]; then
    echo "FAIL: copy is missing $must" >&2
    exit 1
  fi
done
# ... and neither template-local files nor build artifacts
for mustnot in README.md FEATURES.md LICENSE docs node_modules \
               packages/server/dist packages/web/dist packages/web/dist-types \
               data; do
  if [[ -e "$tmp/project/$mustnot" ]]; then
    echo "FAIL: copy contains $mustnot" >&2
    exit 1
  fi
done
echo "copy contents OK"

cd "$tmp/project"
npm install --no-audit --no-fund
npm run lint
npm run typecheck
npm run build
npm test

echo "copy smoke OK"
