#!/bin/bash
# Claude PreToolUse(Edit|Write|NotebookEdit) adapter for the portable generated-path policy.
fp=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
exec "$root/.agents/scripts/check-generated-path.sh" "$fp"
