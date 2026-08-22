#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [--overwrite] <destination>"
}

overwrite=false
dest=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --overwrite)
      overwrite=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      if [[ -n "$dest" ]]; then
        echo "Error: multiple destinations specified." >&2
        usage >&2
        exit 1
      fi
      dest="$1"
      shift
      ;;
  esac
done

if [[ -z "$dest" ]]; then
  echo "Error: destination is required." >&2
  usage >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "$script_dir/.." && pwd)"

if ! git -C "$root_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: not a git checkout — the file list comes from 'git ls-files'." >&2
  exit 1
fi

# git tracks exactly the template's files, so use it as the single source of
# truth; only template-local files are excluded (a new project writes its own)
mapfile -t files < <(git -C "$root_dir" ls-files | grep -v -E '^(docs/|README\.md$|FEATURES\.md$|LICENSE$)')

if [[ ${#files[@]} -eq 0 ]]; then
  echo "Error: 'git ls-files' returned nothing." >&2
  exit 1
fi

mkdir -p "$dest"

if ! $overwrite; then
  existing=()
  for rel_path in "${files[@]}"; do
    if [[ -e "$dest/$rel_path" ]]; then
      existing+=("$rel_path")
    fi
  done
  if [[ ${#existing[@]} -gt 0 ]]; then
    echo "Error: destination already contains the following files:" >&2
    for item in "${existing[@]}"; do
      echo "  - $item" >&2
    done
    echo "Use --overwrite to replace." >&2
    exit 1
  fi
fi

for rel_path in "${files[@]}"; do
  mkdir -p "$dest/$(dirname "$rel_path")"
  cp "$root_dir/$rel_path" "$dest/$rel_path"
done

echo "Copied files:"
printf '  - %s\n' "${files[@]}"
