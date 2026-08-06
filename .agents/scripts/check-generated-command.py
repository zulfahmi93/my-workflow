#!/usr/bin/env python3
"""Block shell commands that WRITE into generated docs output.

The Edit/Write/NotebookEdit hooks already guard `*/docs/html/*`, but they only see the
file-editing tools. `cat > …/docs/html/i.html`, `sed -i`, `cp` and friends went straight
past, so `.agents/rules/docs-site.md:9`'s unconditional "never hand-edit it" was true of
the tools and false of the terminal.

Deliberately CONSERVATIVE, in the same spirit as check-commit-command.py: a write is
blocked only when the generated path can be tied to a write position that this script can
actually resolve. Merely NAMING the path is fine — `grep foo docs/html/x.html` and
`cat docs/html/x.html` are reads, and `echo "see docs/html/x" > notes.md` writes somewhere
else entirely. A missed exotic write is a lint miss; a false block stops real work.

Resolved write positions:
  >, >>, and their fd forms (2>, &>)   target immediately after the operator
  tee [flags] TARGET...                every non-flag operand
  sed -i / -i.bak                      every file operand
  cp / mv / install / rsync            the LAST operand (the destination)
  dd of=TARGET
  truncate / touch                     every non-flag operand

Skipped (reported as unresolvable, never blocked): any command it cannot tokenize, and
any word containing shell expansion, since the real target is not knowable statically.
"""

from __future__ import annotations

import os
import re
import shlex
import sys

GENERATED = re.compile(r"(^|/)docs/html/")
EXPANSION = re.compile(r"[$`]")
REDIRECT = re.compile(r"^[0-9]*(>>?|&>)$")
DEST_LAST = {"cp", "mv", "install", "rsync"}
ALL_OPERANDS = {"tee", "truncate", "touch"}
PUNCTUATION = ";&|()\n"
CONTROL = re.compile(r"^[;&|()\n]+$")


def is_generated(word: str, repo_root: str) -> bool:
    """True when `word` resolves to a path under any `docs/html/` inside the repo."""
    if not word or EXPANSION.search(word):
        return False
    candidate = word if os.path.isabs(word) else os.path.join(repo_root, word)
    normalized = os.path.normpath(candidate)
    if not normalized.startswith(repo_root + os.sep):
        return False
    return bool(GENERATED.search(normalized.replace(os.sep, "/")))


def segments(command: str) -> list[list[str]]:
    lexer = shlex.shlex(command, posix=True, punctuation_chars=PUNCTUATION)
    lexer.whitespace_split = True
    lexer.commenters = ""
    lexer.whitespace = " \t\r"
    out: list[list[str]] = [[]]
    for token in lexer:
        if CONTROL.fullmatch(token):
            if out[-1]:
                out.append([])
            continue
        out[-1].append(token)
    return [s for s in out if s]


def offending(segment: list[str], repo_root: str) -> str | None:
    # Redirections can appear anywhere in the segment, including before the command word.
    for index, word in enumerate(segment):
        if REDIRECT.fullmatch(word) and index + 1 < len(segment):
            if is_generated(segment[index + 1], repo_root):
                return segment[index + 1]
        if word.startswith("of=") and is_generated(word[3:], repo_root):
            return word[3:]

    words = [w for w in segment if not REDIRECT.fullmatch(w)]
    if not words:
        return None
    name = os.path.basename(words[0])
    operands = [w for w in words[1:] if not w.startswith("-")]

    if name in ALL_OPERANDS:
        for w in operands:
            if is_generated(w, repo_root):
                return w
    if name == "sed" and any(w == "-i" or w.startswith("-i") for w in words[1:]):
        # Everything after the script argument is a file operand.
        for w in operands[1:] if len(operands) > 1 else []:
            if is_generated(w, repo_root):
                return w
    if name in DEST_LAST and operands:
        if is_generated(operands[-1], repo_root):
            return operands[-1]
    return None


def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if not command:
        return 0
    repo_root = os.path.normpath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
    )
    try:
        parsed = segments(command)
    except ValueError as error:
        # Same posture as the commit gate: unresolvable means skip, loudly.
        print(f"generated-path policy: skipping unparseable command ({error})", file=sys.stderr)
        return 0

    for segment in parsed:
        hit = offending(segment, repo_root)
        if hit:
            print(
                f"Blocked by .agents/rules/docs-site.md: {hit} is generated output.\n"
                "Edit the plan-NNN.yaml source and rebuild with "
                "`npm run build -- <project>` from tools/docs-gen/.",
                file=sys.stderr,
            )
            return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
