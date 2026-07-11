#!/bin/bash
set -u

cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null)
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
exec "$root/.agents/scripts/check-commit-command.sh" "$cmd"
