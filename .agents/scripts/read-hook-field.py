#!/usr/bin/env python3
"""Read one `tool_input` field from a hook payload on stdin.

Usage: read-hook-field.py [field]     # field defaults to "command"

Replaces `jq -r '.tool_input.<field> // empty' 2>/dev/null` in the adapter hooks. That
form swallowed every failure — a missing `jq`, malformed JSON, an unexpected shape — and
yielded an empty string, so the policy silently did not run and nothing said so.

python3 is already a hard dependency (the policy scripts are Python), so this removes a
dependency rather than adding one. Failures are reported on stderr and exit non-zero, so
the caller decides loudly instead of proceeding on an empty string.
"""

from __future__ import annotations

import json
import sys


def main() -> int:
    field = sys.argv[1] if len(sys.argv) > 1 else "command"

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
        # No tool_input at all is a legitimate shape for some events.
        return 0

    value = tool_input.get(field)
    if value is None:
        return 0
    if not isinstance(value, str):
        print(f"tool_input.{field} is {type(value).__name__}, expected string", file=sys.stderr)
        return 1

    sys.stdout.write(value)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
