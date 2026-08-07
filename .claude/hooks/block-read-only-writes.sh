#!/bin/bash
# Claude PreToolUse(Bash) adapter for the portable read-only-role write policy.
# Companion to block-generated-writes.sh: that one asks "is this write aimed at generated
# output", this one asks "is the ROLE making it allowed to write the repo at all".
set -u

# Fallback resolves from THIS script's location, not $(pwd): the cwd is often inside a
# nested project repo, where .agents/ does not exist, and the exec would silently miss.
root="${CLAUDE_PROJECT_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)}"

# The whole payload on stdin, NOT read-hook-field.py: this policy needs two fields at once
# (`agent_type` to identify the caller and `tool_input.command` to inspect), and that helper
# returns the first single field that is present. Reading them in two passes would need the
# payload twice, and stdin is consumed once.
exec python3 "$root/.agents/scripts/check-read-only-command.py"
