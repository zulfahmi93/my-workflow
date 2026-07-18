#!/bin/bash
# Claude PostToolUse(Edit|Write) adapter for the portable YAML validator.
set -u

# Fallback resolves from THIS script's location, not $(pwd): the cwd is often inside a
# nested project repo, where .agents/ does not exist, and the exec would silently miss.
root="${CLAUDE_PROJECT_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)}"

# python3 rather than jq: `jq … 2>/dev/null` swallowed a missing binary or malformed
# payload and yielded an empty path, silently skipping validation.
if ! fp=$(python3 "$root/.agents/scripts/read-hook-field.py" file_path); then
  echo "docs-yaml validator: could not read hook payload; validation SKIPPED" >&2
  exit 0
fi

exec "$root/.agents/scripts/validate-docs-yaml.sh" "$fp"
