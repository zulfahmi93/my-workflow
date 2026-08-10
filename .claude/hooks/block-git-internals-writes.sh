#!/bin/bash
# Claude PreToolUse(Edit|Write|NotebookEdit) adapter for the portable git-internals write policy.
# Companion to block-generated-html.sh: that one asks "is this write aimed at generated
# output", this one asks "is this write aimed at git's own state" — `.git/config` (where
# core.hooksPath can switch the pre-push gate off) and `.git/hooks/*` (the gate itself).
set -u

# Fallback resolves from THIS script's location, not $(pwd): the cwd is often inside a
# nested project repo, where .agents/ does not exist, and the exec would silently miss.
root="${CLAUDE_PROJECT_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)}"
policy="$root/.agents/scripts/check-git-internals-path.py"

# NOT read-hook-field.py, for two reasons. It returns the FIRST field present, and a payload
# can legitimately carry more than one path-bearing field — the policy has to see all of
# them. And it exits 0 on an unreadable payload, which the callers above translate into
# "policy NOT applied": acceptable when the worst case is a file the next build overwrites,
# not acceptable when the worst case is a silently disarmed push gate. So the whole payload
# goes to the policy, which decides, and fails CLOSED.
if [ ! -f "$policy" ]; then
  echo "git-internals-write policy: cannot find $policy; refusing the write." >&2
  echo "Restore .agents/scripts/check-git-internals-path.py, or make the change with 'git config <key> <value>'." >&2
  exit 2
fi

exec python3 "$policy"
