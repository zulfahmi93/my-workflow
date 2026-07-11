#!/usr/bin/env python3
"""Block forbidden flags on actual `git commit` command segments."""

from __future__ import annotations

import os
import re
import shlex
import sys


CONTROL = re.compile(r"^[;&|]+$")
ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
GIT_OPTIONS_WITH_VALUE = {
    "-C",
    "-c",
    "--config-env",
    "--exec-path",
    "--git-dir",
    "--namespace",
    "--super-prefix",
    "--work-tree",
}
ENV_OPTIONS_WITH_VALUE = {"-C", "--chdir", "-u", "--unset", "-S", "--split-string"}
SUDO_OPTIONS_WITH_VALUE = {
    "-C", "--close-from", "-D", "--chdir", "-g", "--group", "-h", "--host",
    "-p", "--prompt", "-R", "--chroot", "-T", "--command-timeout", "-u", "--user",
}
COMMIT_LONG_OPTIONS_WITH_VALUE = {
    "--author", "--cleanup", "--date", "--file", "--fixup", "--message",
    "--pathspec-from-file", "--reedit-message", "--reuse-message", "--squash",
    "--template", "--trailer",
}
COMMIT_SHORT_OPTIONS_WITH_VALUE = {"C", "F", "c", "m", "t"}


def command_segments(command: str) -> list[list[str]]:
    lexer = shlex.shlex(command, posix=True, punctuation_chars=";&|")
    lexer.whitespace_split = True
    lexer.commenters = ""
    segments: list[list[str]] = [[]]
    for token in lexer:
        if CONTROL.fullmatch(token):
            if segments[-1]:
                segments.append([])
            continue
        segments[-1].append(token)
    return [segment for segment in segments if segment]


def executable_index(segment: list[str]) -> int | None:
    index = 0
    while index < len(segment):
        while index < len(segment) and ASSIGNMENT.match(segment[index]):
            index += 1
        if index >= len(segment):
            return None

        executable = os.path.basename(segment[index])
        if executable == "command":
            index += 1
            while index < len(segment) and segment[index] == "-p":
                index += 1
            if index < len(segment) and segment[index] in {"-v", "-V"}:
                return None
            if index < len(segment) and segment[index] == "--":
                index += 1
            continue

        if executable == "env":
            index += 1
            while index < len(segment):
                token = segment[index]
                if token == "--":
                    index += 1
                    break
                if ASSIGNMENT.match(token):
                    index += 1
                    continue
                if token in ENV_OPTIONS_WITH_VALUE:
                    index += 2
                    continue
                if token.startswith("-"):
                    index += 1
                    continue
                break
            continue

        if executable == "sudo":
            index += 1
            while index < len(segment):
                token = segment[index]
                if token == "--":
                    index += 1
                    break
                if token in SUDO_OPTIONS_WITH_VALUE:
                    index += 2
                    continue
                if token.startswith("-"):
                    index += 1
                    continue
                break
            continue

        return index

    return None


def commit_arguments(segment: list[str]) -> list[str] | None:
    index = executable_index(segment)
    if index is None or os.path.basename(segment[index]) != "git":
        return None
    index += 1

    while index < len(segment):
        token = segment[index]
        if token == "commit":
            return segment[index + 1 :]
        if not token.startswith("-"):
            return None
        if token in GIT_OPTIONS_WITH_VALUE:
            index += 2
            continue
        index += 1
    return None


def forbidden_flag(args: list[str]) -> str | None:
    index = 0
    while index < len(args):
        token = args[index]
        if token == "--":
            return None
        long_name = token.split("=", 1)[0]
        if token.startswith("--") and any(
            target.startswith(long_name) and len(long_name) >= 4
            for target in ("--amend", "--no-verify")
        ):
            return token
        if long_name in COMMIT_LONG_OPTIONS_WITH_VALUE and "=" not in token:
            index += 2
            continue
        if token.startswith("-") and not token.startswith("--"):
            cluster = token[1:]
            for offset, option in enumerate(cluster):
                if option == "n":
                    return token
                if option in COMMIT_SHORT_OPTIONS_WITH_VALUE:
                    if offset == len(cluster) - 1:
                        index += 1
                    break
        index += 1
    return None


def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if not command:
        return 0
    try:
        segments = command_segments(command)
    except ValueError as error:
        print(f"Unable to parse command for commit policy: {error}", file=sys.stderr)
        return 2

    for segment in segments:
        args = commit_arguments(segment)
        if args is None:
            continue
        blocked = forbidden_flag(args)
        if blocked:
            print(f"Blocked by .agents/rules/commit.md: git commit flag {blocked} is forbidden.", file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
