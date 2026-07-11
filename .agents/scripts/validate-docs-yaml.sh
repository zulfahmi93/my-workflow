#!/bin/bash
set -u

file_path=${1:-}
[ -z "$file_path" ] && exit 0

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
generator="$repo_root/tools/docs-gen"
[ -d "$generator" ] || exit 0

absolute_path=$(python3 -c 'import os, sys; root, item = sys.argv[1:]; print(os.path.normpath(item if os.path.isabs(item) else os.path.join(root, item)))' "$repo_root" "$file_path") || exit 2

case "$absolute_path" in
  "$repo_root"/*) ;;
  *) exit 0 ;;
esac

case "$absolute_path" in
  */docs/plan-*.yaml)
    output=$(cd "$generator" && npm run --silent validate 2>&1)
    status=$?
    ;;
  */docs/cycles/*.yaml)
    output=$(cd "$generator" && npm run --silent validate-cycle-note -- "$absolute_path" 2>&1)
    status=$?
    ;;
  *)
    exit 0
    ;;
esac

if [ "$status" -ne 0 ]; then
  echo "documentation YAML validation failed:" >&2
  echo "$output" >&2
  exit 2
fi
