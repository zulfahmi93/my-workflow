#!/bin/bash
# Codex PreToolUse(Bash) adapter for the portable generated-output write policy.
# Companion to dispatch-file-policy.py: that covers apply_patch/Edit/Write, this covers
# the terminal, which previously bypassed the policy entirely.
set -u

# Resolve from THIS script's location, never `git rev-parse --show-toplevel`: inside a
# nested project repo that returns the NESTED root, where .agents/ does not exist, and the
# whole policy would silently not run in exactly the directories most work happens in.
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)

if ! cmd=$(python3 "$root/.agents/scripts/read-hook-field.py" command); then
  echo "generated-path policy: could not read hook payload; policy NOT applied" >&2
  exit 0
fi

exec python3 "$root/.agents/scripts/check-generated-command.py" "$cmd"
