#!/bin/bash
# Claude PreToolUse(Bash) adapter for the portable commit-command policy.
set -u

cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null)
# CLAUDE_PROJECT_DIR is the monorepo root when the harness sets it. The fallback resolves
# from THIS script's own location rather than $(pwd), which would point at a nested project
# repo whenever the cwd is inside projects/<group>/<name>/ — and .agents/ exists only at the
# monorepo root, so the exec would miss and the policy would silently not run.
root="${CLAUDE_PROJECT_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)}"
exec "$root/.agents/scripts/check-commit-command.sh" "$cmd"
