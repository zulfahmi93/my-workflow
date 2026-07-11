#!/bin/bash
# Claude PostToolUse(Edit|Write) adapter for the portable YAML validator.
fp=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
exec "$root/.agents/scripts/validate-docs-yaml.sh" "$fp"
