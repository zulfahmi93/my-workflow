#!/bin/bash
# PostToolUse(Edit|Write) hook — validates plan / cycle-note YAML at write-time
# (.claude/rules/docs-site.md + cycle-orchestration.md §Cycle notes format),
# so a bad enum or unknown key surfaces immediately instead of at commit-time.
fp=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -z "$fp" ] && exit 0
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
gen="$root/tools/docs-gen"
[ -d "$gen" ] || exit 0

case "$fp" in
  */docs/plan-*.yaml)
    out=$(cd "$gen" && npm run --silent validate 2>&1)
    if [ $? -ne 0 ]; then
      echo "plan YAML failed schema validation (tools/docs-gen: npm run validate):" >&2
      echo "$out" >&2
      exit 2
    fi
    ;;
  */docs/cycles/*.yaml)
    out=$(cd "$gen" && npm run --silent validate-cycle-note -- "$fp" 2>&1)
    if [ $? -ne 0 ]; then
      echo "cycle note failed schema validation (tools/docs-gen: npm run validate-cycle-note):" >&2
      echo "$out" >&2
      exit 2
    fi
    ;;
esac
exit 0
