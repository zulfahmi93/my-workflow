#!/bin/bash
set -u

file_path=${1:-}
[ -z "$file_path" ] && exit 0

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
normalized_path=$(python3 -c 'import os, sys; root, item = sys.argv[1:]; print(os.path.normpath(item if os.path.isabs(item) else os.path.join(root, item)))' "$repo_root" "$file_path") || exit 2

case "$normalized_path" in
  "$repo_root"/*) ;;
  *) exit 0 ;;
esac

case "$normalized_path" in
  */docs/html/*)
    echo "Blocked by .agents/rules/docs-site.md: $file_path is generated output. Edit plan-NNN.yaml and rebuild it." >&2
    exit 2
    ;;
esac
