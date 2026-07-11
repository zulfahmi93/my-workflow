#!/bin/bash
# PreToolUse(Bash) hook — enforces .claude/rules/commit.md:
# never skip hooks (--no-verify), never --amend (hook-failed commits get a NEW commit).
# User escape hatch: run the command yourself with the ! prefix in the prompt.
cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$cmd" ] && exit 0
if echo "$cmd" | grep -qE 'git[[:space:]]+([-[:alnum:]=. ]+[[:space:]])?commit' && echo "$cmd" | grep -qE '(--no-verify|--amend)'; then
  echo "Blocked by .claude/rules/commit.md: 'git commit' with --no-verify or --amend is forbidden (fix the hook failure and make a NEW commit; hooks are never skipped). If the user explicitly asked for this, they can run it themselves with the ! prefix." >&2
  exit 2
fi
exit 0
