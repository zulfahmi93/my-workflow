#!/bin/bash
# Claude PreToolUse(Edit|Write|NotebookEdit) adapter for the portable generated-path policy.
set -u

# Fallback resolves from THIS script's location, not $(pwd): the cwd is often inside a
# nested project repo, where .agents/ does not exist, and the exec would silently miss.
root="${CLAUDE_PROJECT_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)}"

# python3 rather than jq: `jq … 2>/dev/null` swallowed a missing binary or malformed
# payload and yielded an empty path, silently disabling the policy.
if ! fp=$(python3 "$root/.agents/scripts/read-hook-field.py" file_path); then
  echo "generated-path policy: could not read hook payload; policy NOT applied" >&2
  exit 0
fi

exec "$root/.agents/scripts/check-generated-path.sh" "$fp"
