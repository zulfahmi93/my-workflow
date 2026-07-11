#!/bin/bash
# Claude PreToolUse(Bash) adapter for the portable commit-command policy.
cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null)
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
exec "$root/.agents/scripts/check-commit-command.sh" "$cmd"
