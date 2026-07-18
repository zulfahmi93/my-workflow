#!/bin/bash
set -u

cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null)
# Resolve the monorepo root from THIS script's own location, never from cwd or git.
# `git rev-parse --show-toplevel` returns the NESTED project repo when the cwd is inside
# projects/<group>/<name>/ — and .agents/ exists only at the monorepo root, so the exec
# below would miss and the entire commit policy would silently not run, in exactly the
# directories where most work happens.
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
exec "$root/.agents/scripts/check-commit-command.sh" "$cmd"
