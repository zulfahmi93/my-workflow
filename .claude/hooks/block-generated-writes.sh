#!/bin/bash
# Claude PreToolUse(Bash) adapter for the portable generated-output write policy.
# Companion to block-generated-html.sh: that one covers the file-editing tools, this one
# covers the terminal, which previously bypassed the policy entirely.
set -u

# Fallback resolves from THIS script's location, not $(pwd): the cwd is often inside a
# nested project repo, where .agents/ does not exist, and the exec would silently miss.
root="${CLAUDE_PROJECT_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)}"

if ! cmd=$(python3 "$root/.agents/scripts/read-hook-field.py" command); then
  echo "generated-path policy: could not read hook payload; policy NOT applied" >&2
  exit 0
fi

exec python3 "$root/.agents/scripts/check-generated-command.py" "$cmd"
