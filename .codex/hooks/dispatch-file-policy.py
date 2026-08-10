#!/usr/bin/env python3
"""Translate Codex apply_patch hook input into portable path-policy calls."""

from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
import sys


PATCH_PATH = re.compile(r"^\*\*\* (Add|Update|Delete) File:\s*(.+?)\s*$")
MOVE_PATH = re.compile(r"^\*\*\* Move to:\s*(.+?)\s*$")

# The argv vocabulary, named once so it is greppable from both sides. validate-agent-config.mjs
# reads this set out of this file and requires every member to be wired in .codex/hooks.json:
# an arm that exists here but is invoked by nothing is a policy that never runs, which is the
# exact shape of the hole `block-git-internals` was added to close on the Claude side.
SUBCOMMANDS = ("block-generated", "validate-yaml", "block-git-internals")


def changed_paths(payload: dict[str, object]) -> list[tuple[str, str]]:
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return []
    paths: list[tuple[str, str]] = []
    # notebook_path as well as file_path: a notebook edit names its target differently, and
    # reading only file_path silently waves every notebook through.
    for key in ("file_path", "notebook_path"):
        value = tool_input.get(key)
        if isinstance(value, str) and value:
            paths.append(("Update", value))
    command = tool_input.get("command")
    if isinstance(command, str):
        for line in command.splitlines():
            if match := PATCH_PATH.match(line):
                paths.append((match.group(1), match.group(2)))
            elif match := MOVE_PATH.match(line):
                paths.append(("Update", match.group(1)))
    return list(dict.fromkeys(paths))


def git_internal_targets(payload: dict[str, object]) -> list[str]:
    """Every path the git-internals policy would look at, from a Codex payload.

    changed_paths() knows two field names plus the apply_patch body. The policy on the other
    end sweeps ANY `*_path` / `*Path` string field, on the stated grounds that a target it
    does not look at is a target it cannot block. The same sweep is mirrored here, and it is
    load-bearing rather than defensive: this arm refuses a payload it can find no target in,
    so a field name only one of the two knows about would turn every Codex edit into a false
    block. The two must know the same field names.
    """
    targets = [path for _, path in changed_paths(payload)]
    tool_input = payload.get("tool_input")
    if isinstance(tool_input, dict):
        for key, value in tool_input.items():
            if not isinstance(value, str) or not value.strip():
                continue
            if key.endswith("_path") or key.endswith("Path") or key == "path":
                targets.append(value)
    return list(dict.fromkeys(targets))


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in SUBCOMMANDS:
        print(f"usage: dispatch-file-policy.py {'|'.join(SUBCOMMANDS)}", file=sys.stderr)
        return 2
    mode = sys.argv[1]

    # Report a malformed payload loudly and fail OPEN, matching read-hook-field.py on the
    # Claude side. Previously this raised a raw JSONDecodeError traceback, which reads as a
    # harness crash rather than "the policy did not run".
    #
    # `block-git-internals` is the one arm that fails CLOSED instead, because the policy it
    # dispatches to does: the worst case on the other two is a file the next `npm run build`
    # overwrites, and the worst case here is a silently disarmed pre-push hook on repos that
    # deploy. See the FAIL CLOSED section of check-git-internals-path.py — an adapter that
    # falls open in front of a policy that fails closed simply deletes the policy's guarantee.
    unreadable = 2 if mode == "block-git-internals" else 0
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        verdict = "refusing the write" if unreadable else "policy NOT applied"
        print(f"file-policy: hook payload is not valid JSON ({error}); {verdict}", file=sys.stderr)
        return unreadable
    if not isinstance(payload, dict):
        verdict = "refusing the write" if unreadable else "policy NOT applied"
        print(f"file-policy: hook payload is not a JSON object; {verdict}", file=sys.stderr)
        return unreadable

    repo_root = Path(__file__).resolve().parents[2]
    if mode == "block-generated":
        script = repo_root / ".agents/scripts/check-generated-path.sh"
        candidates = changed_paths(payload)
    elif mode == "block-git-internals":
        # No Delete filter, unlike validate-yaml. Removing `.git/hooks/pre-push` disarms the
        # push gate exactly as well as overwriting it does, so a deletion is the thing being
        # blocked, not an exemption from it.
        script = repo_root / ".agents/scripts/check-git-internals-path.py"
        candidates = [("Update", target) for target in git_internal_targets(payload)]
    else:
        script = repo_root / ".agents/scripts/validate-docs-yaml.sh"
        candidates = [(action, path) for action, path in changed_paths(payload) if action != "Delete"]

    if mode == "block-git-internals":
        # That policy takes a hook PAYLOAD on stdin, not a path in argv — it is a PreToolUse
        # policy shared with the Claude adapter, and its contract is JSON in / exit code out.
        # So each candidate is re-wrapped into the payload shape it expects rather than the
        # argv shape the other two use.
        if not candidates:
            print(
                "git-internals-write policy: no target path in the Codex payload; refusing the "
                "write rather than guessing it is safe.",
                file=sys.stderr,
            )
            return 2
        for _, candidate in candidates:
            probe = json.dumps({
                "tool_name": payload.get("tool_name", "apply_patch"),
                "tool_input": {"file_path": candidate},
            })
            result = subprocess.run(
                [sys.executable or "python3", str(script)],
                cwd=repo_root, input=probe, text=True, check=False,
            )
            if result.returncode:
                return result.returncode
        return 0

    for _, candidate in candidates:
        result = subprocess.run([str(script), candidate], cwd=repo_root, check=False)
        if result.returncode:
            return result.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
