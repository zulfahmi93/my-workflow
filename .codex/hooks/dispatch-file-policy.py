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


def changed_paths(payload: dict[str, object]) -> list[tuple[str, str]]:
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return []
    paths: list[tuple[str, str]] = []
    file_path = tool_input.get("file_path")
    if isinstance(file_path, str) and file_path:
        paths.append(("Update", file_path))
    command = tool_input.get("command")
    if isinstance(command, str):
        for line in command.splitlines():
            if match := PATCH_PATH.match(line):
                paths.append((match.group(1), match.group(2)))
            elif match := MOVE_PATH.match(line):
                paths.append(("Update", match.group(1)))
    return list(dict.fromkeys(paths))


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in {"block-generated", "validate-yaml"}:
        print("usage: dispatch-file-policy.py block-generated|validate-yaml", file=sys.stderr)
        return 2
    payload = json.load(sys.stdin)
    repo_root = Path(__file__).resolve().parents[2]
    if sys.argv[1] == "block-generated":
        script = repo_root / ".agents/scripts/check-generated-path.sh"
        candidates = changed_paths(payload)
    else:
        script = repo_root / ".agents/scripts/validate-docs-yaml.sh"
        candidates = [(action, path) for action, path in changed_paths(payload) if action != "Delete"]
    for _, candidate in candidates:
        result = subprocess.run([str(script), candidate], cwd=repo_root, check=False)
        if result.returncode:
            return result.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
