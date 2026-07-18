#!/bin/bash
set -u

# Resolve the monorepo root from THIS script's own location, never from cwd or git.
# `git rev-parse --show-toplevel` returns the NESTED project repo when the cwd is inside
# projects/<group>/<name>/ — and .agents/ exists only at the monorepo root, so the exec
# below would miss and the entire commit policy would silently not run, in exactly the
# directories where most work happens.
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)

# Extract via python3 (already required by the policy script) rather than jq, whose
# `2>/dev/null` swallowed a missing binary or malformed payload and yielded an empty
# command — the policy would then silently pass everything.
if ! cmd=$(python3 "$root/.agents/scripts/read-hook-command.py"); then
  echo "commit-policy: could not read hook payload; policy NOT applied" >&2
  exit 0
fi

exec "$root/.agents/scripts/check-commit-command.sh" "$cmd"
