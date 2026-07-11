#!/bin/bash
# PreToolUse(Edit|Write|NotebookEdit) hook — enforces .claude/rules/docs-site.md:
# everything under a project's docs/html/ is generated output; never hand-edit.
fp=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -z "$fp" ] && exit 0
case "$fp" in
  */docs/html/*)
    echo "Blocked by .claude/rules/docs-site.md: $fp is generated output. Edit the plan-NNN.yaml source and run 'npm run build -- <project>' from tools/docs-gen/." >&2
    exit 2
    ;;
esac
exit 0
