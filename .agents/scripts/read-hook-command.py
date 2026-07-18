#!/usr/bin/env python3
"""Read `.tool_input.command` from a hook payload on stdin.

Replaces a `jq -r ... 2>/dev/null` call in both adapters. That form swallowed every
failure — a missing `jq`, malformed JSON, an unexpected shape — and yielded an empty
command, so the commit policy silently did not run and nothing said so.

python3 is already a hard dependency (the policy script itself is Python), so this removes
a dependency rather than adding one. Failures are reported on stderr and exit non-zero, so
the caller can decide loudly instead of proceeding on an empty string.
"""

from __future__ import annotations

import json
import sys


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        print(f"hook payload is not valid JSON: {error}", file=sys.stderr)
        return 1
    if not isinstance(payload, dict):
        print("hook payload is not a JSON object", file=sys.stderr)
        return 1
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        # No tool_input at all is a legitimate shape for non-Bash events.
        return 0
    command = tool_input.get("command")
    if command is None:
        return 0
    if not isinstance(command, str):
        print(f"tool_input.command is {type(command).__name__}, expected string", file=sys.stderr)
        return 1
    sys.stdout.write(command)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
