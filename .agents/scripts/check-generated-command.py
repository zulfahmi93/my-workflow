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

Exec wrappers and shell payloads are resolved through, because they hid the write entirely
rather than making it exotic — see EXEC_WRAPPERS and shell_payload() below.
"""

from __future__ import annotations

import os
import re
import shlex
import sys

GENERATED = re.compile(r"(^|/)docs/html/")
EXPANSION = re.compile(r"[$`]")
# Operators whose following word is a file the shell truncates or appends to.
REDIRECT = re.compile(r"^[0-9]*(>>?\|?|>&|&>>?)$")
# Operators whose following word is a redirect operand the shell never writes to: input
# redirects, heredoc/herestring markers, and fd duplications. They are skipped along with
# their operand so they cannot be mistaken for command operands — otherwise
# `tee /tmp/copy < …/docs/html/i.html`, which only READS the generated file, false-blocks.
READ_REDIRECT = re.compile(r"^[0-9]*<(<<?|&)?$")
DEST_LAST = {"cp", "mv", "install", "rsync"}
ALL_OPERANDS = {"tee", "truncate", "touch"}
# `<` and `>` must be punctuation, or a spaceless redirect lexes as ONE word and REDIRECT
# never matches (#20: `echo x >projects/…/docs/html/index.html` sailed past the gate at
# exit 0, and the hand-edit then vanished silently on the next `npm run build`; the same
# hole swallowed `>>file`, `1>file`, `2>file` and `&>file`).
# They must NOT join CONTROL: a redirect operator is not a segment separator. Treating one
# as a separator cuts `cmd >file` in half, stranding the target in a segment with no
# command word and changing how every other rule below reads the line.
PUNCTUATION = ";&|()\n<>"
CONTROL = re.compile(r"^[;&|()\n]+$")

# Generic exec wrappers: each parses its OWN options and then EXECS the command that
# follows. Every one of them was opaque here, so the command word this script keys its
# tee/cp/mv/sed/truncate rules on resolved to the WRAPPER, no rule fired, and the write
# went through at exit 0 — measured on `nohup cp /tmp/x.html <gen>` and
# `env FOO=bar tee <gen>`. A redirect is unaffected (the OUTER shell parses it, so it is
# already visible in the segment); only the command word was hidden.
#
# Per wrapper: (options taking a SEPARATE value, positional operands consumed BEFORE the
# command). `timeout` eats a DURATION and `chrt` a PRIORITY; the rest exec the next word.
# Kept deliberately in step with check-commit-command.py's table of the same name — the two
# gates guard different rules over the same shell grammar, and a wrapper known to one and
# not the other is a hole by construction.
EXEC_WRAPPERS = {
    "nohup": (frozenset(), 0),
    "setsid": (frozenset(), 0),
    "command": (frozenset(), 0),
    "sudo": (
        frozenset({"-C", "--close-from", "-D", "--chdir", "-g", "--group", "-h", "--host",
                   "-p", "--prompt", "-R", "--chroot", "-T", "--command-timeout",
                   "-u", "--user"}),
        0,
    ),
    "env": (frozenset({"-u", "--unset", "-C", "--chdir", "-S", "--split-string"}), 0),
    "xargs": (
        frozenset({"-a", "--arg-file", "-d", "--delimiter", "-E", "-I", "-i", "--replace",
                   "-L", "-l", "--max-lines", "-n", "--max-args", "-P", "--max-procs",
                   "-s", "--max-chars"}),
        0,
    ),
    "nice": (frozenset({"-n", "--adjustment"}), 0),
    "stdbuf": (frozenset({"-i", "--input", "-o", "--output", "-e", "--error"}), 0),
    "time": (frozenset({"-f", "--format", "-o", "--output"}), 0),
    "ionice": (
        frozenset({"-c", "--class", "-n", "--classdata", "-p", "--pid", "-P", "--pgid",
                   "-u", "--uid"}),
        0,
    ),
    "timeout": (frozenset({"-s", "--signal", "-k", "--kill-after"}), 1),
    "chrt": (
        frozenset({"-p", "--pid", "-T", "--sched-runtime", "-P", "--sched-period",
                   "-D", "--sched-deadline"}),
        1,
    ),
}
# `env FOO=bar cmd` — a leading assignment is not an option and not the command word.
ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
# `timeout`'s DURATION and `chrt`'s PRIORITY. Anything else in that slot is unresolvable, so
# it is NOT consumed — consuming it would shift the real command word out of reach.
WRAPPER_OPERAND = re.compile(r"^\d*\.?\d+[smhd]?$")
SHELL_EXECUTABLES = {"sh", "bash", "zsh", "dash", "ksh"}
SHELL_OPTIONS_WITH_VALUE = {"-o", "+o", "--rcfile", "--init-file"}
MAX_SHELL_NESTING = 3


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


def strip_redirects(segment: list[str]) -> list[str]:
    """The segment minus every redirect operator AND the operand it consumes.

    What is left is the command word plus its real operands. Write targets are resolved
    separately, over the RAW segment, so nothing is lost by dropping them here.
    """
    words: list[str] = []
    skip_operand = False
    for word in segment:
        if skip_operand:
            skip_operand = False
            continue
        if REDIRECT.fullmatch(word) or READ_REDIRECT.fullmatch(word):
            skip_operand = True
            continue
        words.append(word)
    return words


def command_index(words: list[str]) -> int | None:
    """Index of the real command word, resolving through any leading exec wrappers.

    Returns None when the segment is nothing but wrappers, or when a wrapper's option
    grammar runs off the end. Both mean "no command word here", which this gate treats the
    way it treats every other unresolvable shape: no block.
    """
    index = 0
    hops = 0
    while index < len(words):
        if hops > len(EXEC_WRAPPERS):
            return None
        name = os.path.basename(words[index])
        spec = EXEC_WRAPPERS.get(name)
        if spec is None:
            return index
        value_options, operands = spec
        hops += 1
        index += 1
        while index < len(words):
            token = words[index]
            if token == "--":
                index += 1
                break
            if name == "env" and ASSIGNMENT.match(token):
                index += 1
                continue
            if token in value_options:
                index += 2
                continue
            if len(token) > 1 and token.startswith("-"):
                index += 1
                continue
            break
        while operands and index < len(words) and WRAPPER_OPERAND.fullmatch(words[index]):
            index += 1
            operands -= 1
    return None


def shell_payload(words: list[str]) -> str | None:
    """The command string a `bash -c '<cmd>'` style wrapper will execute, if any.

    Without this, `bash -c 'echo x > <gen>'` reached offending() as the single command word
    `bash` with one opaque operand: the redirect is INSIDE a quoted token, so the scan over
    the segment never sees an operator and the write went through at exit 0. Measured on
    bash/sh/zsh and on `eval` — the same silent write-through as #20, reached through a
    lexical wrapper instead of missing punctuation. The payload is re-lexed by
    check_command() rather than index-skipped, because it is one token here and a whole
    command line to the shell that runs it.
    """
    index = command_index(words)
    if index is None or os.path.basename(words[index]) not in SHELL_EXECUTABLES:
        return None
    index += 1
    saw_c = False
    while index < len(words):
        token = words[index]
        if token == "--":
            index += 1
            if saw_c:
                break
            continue
        if token in SHELL_OPTIONS_WITH_VALUE:
            index += 2
            continue
        if len(token) > 1 and token[0] in "-+":
            if "c" in token[1:]:
                saw_c = True
            index += 1
            continue
        break
    if not saw_c or index >= len(words):
        return None
    return words[index]


def eval_payload(words: list[str]) -> str | None:
    """The command string `eval` will run, if this segment is an eval.

    `eval` is NOT an exec wrapper and must not be added to EXEC_WRAPPERS: it does not exec
    its first operand, it CONCATENATES all of them into one command line and re-parses that.
    """
    index = command_index(words)
    if index is None or os.path.basename(words[index]) != "eval":
        return None
    operands = words[index + 1 :]
    if operands and operands[0] == "--":  # `eval -- '<cmd>'` is the same eval
        operands = operands[1:]
    return " ".join(operands) if operands else None


def offending(segment: list[str], repo_root: str) -> str | None:
    # Redirections can appear anywhere in the segment, including before the command word.
    for index, word in enumerate(segment):
        if REDIRECT.fullmatch(word) and index + 1 < len(segment):
            if is_generated(segment[index + 1], repo_root):
                return segment[index + 1]
        if word.startswith("of=") and is_generated(word[3:], repo_root):
            return word[3:]

    words = strip_redirects(segment)
    start = command_index(words)
    if start is None:
        return None
    name = os.path.basename(words[start])
    operands = [w for w in words[start + 1 :] if not w.startswith("-")]

    if name in ALL_OPERANDS:
        for w in operands:
            if is_generated(w, repo_root):
                return w
    if name == "sed" and any(w == "-i" or w.startswith("-i") for w in words[start + 1 :]):
        # Everything after the script argument is a file operand.
        for w in operands[1:] if len(operands) > 1 else []:
            if is_generated(w, repo_root):
                return w
    if name in DEST_LAST and operands:
        if is_generated(operands[-1], repo_root):
            return operands[-1]
    return None


def check_command(command: str, repo_root: str, depth: int = 0) -> int:
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
        words = strip_redirects(segment)
        for payload in (shell_payload(words), eval_payload(words)):
            if not payload:
                continue
            if depth >= MAX_SHELL_NESTING:
                # Fails OPEN, unlike the commit gate's depth cap. This gate guards against
                # a hand-edit that the next `npm run build` silently overwrites, not against
                # an adversary; four levels of deliberate shell nesting is not that mistake,
                # and a textual fallback here cannot tell a repo-relative generated path
                # from prose that merely names one.
                print(
                    "generated-path policy: shell nesting limit reached, payload not "
                    "inspected",
                    file=sys.stderr,
                )
                continue
            if check_command(payload, repo_root, depth + 1) == 2:
                return 2
    return 0


def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if not command:
        return 0
    repo_root = os.path.normpath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
    )
    return check_command(command, repo_root)


if __name__ == "__main__":
    raise SystemExit(main())
