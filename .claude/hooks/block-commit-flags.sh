#!/bin/bash
# Claude PreToolUse(Bash) adapter for the portable commit-command policy.
set -u

# CLAUDE_PROJECT_DIR is the monorepo root when the harness sets it. The fallback resolves
# from THIS script's own location rather than $(pwd), which would point at a nested project
# repo whenever the cwd is inside projects/<group>/<name>/ — and .agents/ exists only at the
# monorepo root, so the exec would miss and the policy would silently not run.
root="${CLAUDE_PROJECT_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)}"

# Extract via python3 (already required by the policy script) rather than jq, whose
# `2>/dev/null` swallowed a missing binary or malformed payload and yielded an empty
# command — the policy would then silently pass everything.
if ! cmd=$(python3 "$root/.agents/scripts/read-hook-field.py"); then
  echo "commit-policy: could not read hook payload; policy NOT applied" >&2
  exit 0
fi

exec "$root/.agents/scripts/check-commit-command.sh" "$cmd"
