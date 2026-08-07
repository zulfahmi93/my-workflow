#!/usr/bin/env python3
"""Enforce commit policy on actual `git commit` command segments.

Two checks:
  1. Forbidden flags (`--amend`, `--no-verify`, `-n`).
  2. Subject length <= 50 chars (.agents/rules/commit.md).

The subject check is deliberately CONSERVATIVE: it only fires when the subject can be
read statically from the command line. Anything whose text this script cannot resolve —
`-F file`, `-C`/`-c` reuse, `--fixup`/`--squash`, `-t` template, an editor commit with no
`-m`, or a message containing shell expansion it cannot evaluate — is SKIPPED rather than
guessed at. A false block here would stop all work; a missed long subject is a lint miss.

It does resolve the `-m "$(cat <<'EOF' ... EOF)"` heredoc form, which is the dominant
pattern in this repo — without that the gate would be decorative.
"""

from __future__ import annotations

import os
import re
import shlex
import sys


# Segment separators.
#   ( )  — without them `whitespace_split` glues a subshell's closing paren onto the
#          preceding token, so `(cd x && git commit -m "…")` measured a trailing `")`
#          (false positive) and `(git commit …)` hid the commit entirely (false negative).
#   \n   — a newline is ordinary whitespace to shlex, so a newline-joined script collapsed
#          into ONE segment and a `git commit` on a later line was never seen. Newlines
#          INSIDE quotes are unaffected: shlex consumes those as part of the token.
CONTROL = re.compile(r"^[;&|()\n]+$")
PUNCTUATION = ";&|()\n"
# shlex must stop treating \n as whitespace or it would never emit it as a token.
LEXER_WHITESPACE = " \t\r"
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
# `xargs git commit --amend` runs git directly, so xargs is transparent the same way
# `env` and `sudo` are: skip it and its options, then keep looking for the executable.
XARGS_OPTIONS_WITH_VALUE = {
    "-a", "--arg-file", "-d", "--delimiter", "-E", "-e", "--eof", "-I", "-i", "--replace",
    "-L", "-l", "--max-lines", "-n", "--max-args", "-P", "--max-procs", "-s", "--max-chars",
}
# `bash -c '<cmd>'` hides the whole command inside one token, so unwrapping it needs a
# re-lex rather than an index skip — see shell_payload() and check_command()'s recursion.
SHELL_EXECUTABLES = {"bash", "sh", "zsh", "dash", "ksh"}
SHELL_OPTIONS_WITH_VALUE = {"-o", "+o"}
# Depth cap so a pathological `bash -c "bash -c \"...\""` chain cannot spin.
MAX_SHELL_NESTING = 3

# Generic exec wrappers: each parses its OWN options and then EXECS the command that follows.
# Every one of them was opaque here, so `nohup git commit --amend`, `timeout 120 git commit
# --no-verify`, `nice`, `setsid`, `stdbuf`, `time`, `ionice` and `chrt` all reached
# commit_arguments() as an executable that is not `git`; it returned None and BOTH checks
# were skipped in silence. Measured: seven one-word prefixes each turned a hard-blocked
# command into exit 0, defeating the one UNCONDITIONAL guarantee .agents/rules/commit.md
# makes (the subject check is documented as skippable; the flag check is not).
#
# Per wrapper: (options taking a SEPARATE value, valueless flags, positional operands the
# wrapper consumes BEFORE the command). `timeout` eats a DURATION and `chrt` a PRIORITY;
# the other six exec the very next word.
EXEC_WRAPPERS = {
    "nohup": (frozenset(), frozenset(), 0),
    "nice": (frozenset({"-n", "--adjustment"}), frozenset(), 0),
    "setsid": (frozenset(), frozenset({"-c", "--ctty", "-f", "--fork", "-w", "--wait"}), 0),
    "stdbuf": (
        frozenset({"-i", "--input", "-o", "--output", "-e", "--error"}),
        frozenset(),
        0,
    ),
    "time": (
        frozenset({"-f", "--format", "-o", "--output"}),
        frozenset({"-a", "--append", "-p", "--portability", "-v", "--verbose"}),
        0,
    ),
    "timeout": (
        frozenset({"-s", "--signal", "-k", "--kill-after"}),
        frozenset({"--foreground", "--preserve-status", "-v", "--verbose"}),
        1,
    ),
    "ionice": (
        frozenset({"-c", "--class", "-n", "--classdata", "-p", "--pid", "-P", "--pgid",
                   "-u", "--uid"}),
        frozenset({"-t", "--ignore"}),
        0,
    ),
    "chrt": (
        frozenset({"-p", "--pid", "-T", "--sched-runtime", "-P", "--sched-period",
                   "-D", "--sched-deadline"}),
        frozenset({"-a", "--all-tasks", "-b", "--batch", "-d", "--deadline", "-f", "--fifo",
                   "-i", "--idle", "-m", "--max", "-o", "--other", "-r", "--rr",
                   "-R", "--reset-on-fork", "-v", "--verbose"}),
        1,
    ),
}
# Accepted by every wrapper above and shared rather than repeated eight times. They take no
# value and exec no command, so classifying them costs nothing and keeps `nice --help` from
# reporting itself as unresolvable.
WRAPPER_TERMINAL_FLAGS = frozenset({"--help", "--version"})
# POSIX legacy `nice -10 cmd` — the increment written as the option itself. Gated to `nice`
# on purpose: for `timeout`/`chrt` a bare `-<n>` is not an option, and swallowing one there
# would shift their operand onto `git` and hide the commit again.
NICE_ADJUSTMENT = re.compile(r"^-\d+$")
# `timeout`'s DURATION and `chrt`'s PRIORITY. Anything else in that slot (`timeout $T git
# commit --amend`) is not something this script can resolve, so it must NOT be consumed as
# the operand — see UnresolvedWrapper.
WRAPPER_OPERAND = re.compile(r"^\d*\.?\d+[smhd]?$")
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

# .agents/rules/commit.md §Conventional Commits: "subject <= 50 chars".
SUBJECT_LIMIT = 50

# Message sources this script cannot read. Their presence makes the subject
# undeterminable, so the length check is skipped rather than guessed.
OPAQUE_LONG_OPTIONS = {
    "--file", "--reuse-message", "--reedit-message", "--fixup", "--squash", "--template",
}
OPAQUE_SHORT_OPTIONS = {"F", "C", "c", "t"}

# Every `git commit` long option, so an ABBREVIATION can be resolved the way git resolves
# it: any unambiguous prefix is accepted (`--mess` means `--message`). Matching the full
# spelling only let `git commit --mess "<long subject>"` through unchecked.
COMMIT_LONG_OPTIONS = {
    "--all", "--allow-empty", "--allow-empty-message", "--amend", "--author", "--branch",
    "--cleanup", "--date", "--dry-run", "--edit", "--file", "--fixup", "--gpg-sign",
    "--include", "--long", "--message", "--no-edit", "--no-gpg-sign", "--no-post-rewrite",
    "--no-status", "--no-verify", "--null", "--only", "--patch", "--pathspec-file-nul",
    "--pathspec-from-file", "--porcelain", "--quiet", "--reedit-message", "--reset-author",
    "--reuse-message", "--short", "--signoff", "--squash", "--status", "--template",
    "--trailer", "--untracked-files", "--verbose",
}

# `-m "$(cat <<'EOF' \n <subject> \n ... \n EOF \n )"` — the repo's dominant commit form.
# Deliberately loose about spacing and the delimiter (`cat<<EOF`, `<<-MSG`, `<<"X_1"` all
# match); the strict `cat\s+` + word-only delimiter form missed real invocations.
HEREDOC_SUBSTITUTION = re.compile(r"^\$\(\s*cat\s*<<-?\s*(['\"]?)([^\s'\";)]+)\1")

# Any shell expansion or ANSI-C quoting — the value cannot be resolved statically, so the
# subject check must skip rather than measure the literal text. Deliberately broad: `$VAR`,
# `${VAR}`, `$(cmd)`, `$'...'` and backticks all count. A subject containing a literal `$`
# is rare, and skipping one is far cheaper than wrongly blocking a commit.
UNRESOLVABLE = re.compile(r"[$`]")

# A heredoc opener anywhere on a line: <<EOF, <<-EOF, <<'EOF', <<"EOF".
# Same delimiter charset as HEREDOC_SUBSTITUTION above — a word-only charset here would
# fail to strip a body opened with an exotic delimiter, which is the case that needed
# stripping most.
HEREDOC_OPENER = re.compile(r"<<-?\s*(['\"]?)([^\s'\";)]+)\1")

# Last-resort scan when the command cannot be tokenized at all.
#
# This must match an actual `git … commit … --amend` shape, NOT the bare flag. The earlier
# `"commit" in command and (--amend|--no-verify)` substring pair fired on any unparseable
# command that merely MENTIONED both — `echo it doesn't commit; grep -- --amend f` was
# blocked live. That is a fail-CLOSED path inside a function whose whole contract is to
# fail open. Requiring git + commit + the flag with no command separator between them keeps
# the real bypass covered and drops the prose false positives.
FORBIDDEN_FALLBACK = re.compile(
    r"\bgit\b[^\n;&|]*\bcommit\b[^\n;&|]*?(?:--amend|--no-verify)\b"
)


class UnresolvedWrapper(ValueError):
    """An exec wrapper's option grammar could not be resolved for this segment.

    Raised instead of returning None from executable_index(), because None means "no
    executable here" and is waved through — which is exactly how the wrappers became a
    bypass. This routes the segment to unresolvable_segment() instead, so a `git commit
    --amend` hiding behind an option we could not classify still gets caught textually.
    """


def skip_wrapper(
    name: str,
    spec: tuple[frozenset[str], frozenset[str], int],
    segment: list[str],
    index: int,
) -> int:
    """Advance past an exec wrapper's own options (and operand) to the command it execs.

    Fails CLOSED: an option this table does not know could take a value, and guessing wrong
    slides the index onto `git` and hides the whole invocation. So an unrecognised token
    raises rather than being skipped as if it were valueless.
    """
    options_with_value, flags, operands = spec
    index += 1
    while index < len(segment):
        token = segment[index]
        if token == "--":
            index += 1
            break
        if len(token) < 2 or not token.startswith("-"):
            break
        long_name = token.split("=", 1)[0]
        if token.startswith("--") and "=" in token:
            if long_name not in options_with_value and long_name not in flags:
                raise UnresolvedWrapper(f"{name}: unrecognised option {token}")
            index += 1
            continue
        if token in flags or token in WRAPPER_TERMINAL_FLAGS:
            index += 1
            continue
        if token in options_with_value:
            index += 2
            continue
        # Attached short value: `stdbuf -o0`, `ionice -c2`, `nice -n19`.
        if not token.startswith("--") and token[:2] in options_with_value:
            index += 1
            continue
        if name == "nice" and NICE_ADJUSTMENT.fullmatch(token):
            index += 1
            continue
        raise UnresolvedWrapper(f"{name}: unrecognised option {token}")
    for _ in range(operands):
        if index >= len(segment):
            return index  # wrapper with nothing after it — no command to check
        if not WRAPPER_OPERAND.fullmatch(segment[index]):
            raise UnresolvedWrapper(f"{name}: {segment[index]!r} is not a resolvable operand")
        index += 1
    # `timeout 30 -- git commit --amend`: a separator AFTER the operand. Consuming it costs
    # nothing on a benign command and stops `--` being read as the executable, which is the
    # same "executable is not git" hole the wrappers themselves opened.
    if index < len(segment) and segment[index] == "--":
        index += 1
    return index


def command_segments(command: str) -> list[list[str]]:
    lexer = shlex.shlex(command, posix=True, punctuation_chars=PUNCTUATION)
    lexer.whitespace_split = True
    lexer.commenters = ""
    lexer.whitespace = LEXER_WHITESPACE
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

        if executable == "xargs":
            index += 1
            while index < len(segment):
                token = segment[index]
                if token == "--":
                    index += 1
                    break
                if token in XARGS_OPTIONS_WITH_VALUE:
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

        if executable in EXEC_WRAPPERS:
            index = skip_wrapper(executable, EXEC_WRAPPERS[executable], segment, index)
            continue

        return index

    return None


def shell_payload(segment: list[str]) -> str | None:
    """The command string a `bash -c '<cmd>'` style wrapper will execute, if any.

    Without this, `bash -c 'git commit --amend'` reaches commit_arguments() as the single
    executable `bash` and is waved through — a complete bypass of both checks. The payload
    is re-lexed by check_command() rather than index-skipped, because it is one token here
    and a whole command line to the shell that runs it.
    """
    index = executable_index(segment)
    if index is None or os.path.basename(segment[index]) not in SHELL_EXECUTABLES:
        return None
    index += 1
    saw_c = False
    while index < len(segment):
        token = segment[index]
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
    if not saw_c or index >= len(segment):
        return None
    return segment[index]


def eval_payload(segment: list[str]) -> str | None:
    """The command string `eval` will run, if this segment is an eval.

    `eval` is NOT an exec wrapper and must not be added to EXEC_WRAPPERS: it does not exec
    its first operand, it CONCATENATES all of them into one command line and re-parses that.
    So it gets the shell_payload() treatment — join, then re-lex through check_command() —
    which is what `eval "git commit --amend --no-edit"` needs; measured as exit 0 before.
    """
    index = executable_index(segment)
    if index is None or os.path.basename(segment[index]) != "eval":
        return None
    operands = segment[index + 1 :]
    if operands and operands[0] == "--":  # `eval -- '<cmd>'` is the same eval
        operands = operands[1:]
    return " ".join(operands) if operands else None


def unresolvable_segment(segment: list[str], reason: str) -> int:
    """Policy for one segment this script could not resolve down to an executable.

    Fails open like unparseable_fallback(), behind the same narrow textual scan — but over
    the SEGMENT rather than the whole command, so one unresolvable segment cannot make a
    sibling `echo "git commit --amend"` read as an invocation.
    """
    if FORBIDDEN_FALLBACK.search(" ".join(segment)):
        print(
            "Blocked by .agents/rules/commit.md: forbidden git commit flag detected "
            f"({reason}).",
            file=sys.stderr,
        )
        return 2
    print(f"commit-policy: skipping unresolvable command ({reason})", file=sys.stderr)
    return 0


def git_subcommand_arguments(segment: list[str], subcommand: str) -> list[str] | None:
    index = executable_index(segment)
    if index is None or os.path.basename(segment[index]) != "git":
        return None
    index += 1

    while index < len(segment):
        token = segment[index]
        if token == subcommand:
            return segment[index + 1 :]
        if not token.startswith("-"):
            return None
        if token in GIT_OPTIONS_WITH_VALUE:
            index += 2
            continue
        index += 1
    return None


def commit_arguments(segment: list[str]) -> list[str] | None:
    return git_subcommand_arguments(segment, "commit")


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


# `.agents/rules/cycle-orchestration.md` §"Never, even when authorized" listed five things.
# Two were hard-blocked here; push, force ops and opening PRs were honor-system, and sitting in
# one list they inherited the credibility of the enforced pair. Seven repos in this monorepo have
# live GitHub remotes, so an unattended run reached real GitHub with nothing in the way.
#
# Deliberately NOT blocking plain `git push`: pushing zulfahmi-portfolio to main is what deploys
# zulfahmi.dev, so a blanket block would break a real workflow to close a theoretical hole. What
# is blocked is the subset that cannot be undone by pushing again — rewriting published history —
# plus opening or merging PRs, which is outward-facing. The rule file now separates the enforced
# items from the advisory ones so the two stop sharing a heading.
FORCE_PUSH_TARGETS = ("--force", "--force-with-lease", "--force-if-includes")
PUSH_LONG_OPTIONS_WITH_VALUE = {"--repo", "--exec", "--receive-pack", "--push-option"}
PUSH_SHORT_OPTIONS_WITH_VALUE = {"o"}
GH_OPTIONS_WITH_VALUE = {"--repo", "-R"}
GH_FORBIDDEN_SUBCOMMANDS = {("pr", "create"), ("pr", "merge")}


def forbidden_push_flag(args: list[str]) -> str | None:
    index = 0
    while index < len(args):
        token = args[index]
        if token == "--":
            return None
        long_name = token.split("=", 1)[0]
        # Same abbreviation rule git's parse-options uses, and the same >= 4 floor the commit
        # flag check uses: `--forc` resolves to --force, while `--f`/`--fo` are ambiguous with
        # --follow-tags and git rejects them itself.
        if token.startswith("--") and any(
            target.startswith(long_name) and len(long_name) >= 4
            for target in FORCE_PUSH_TARGETS
        ):
            return token
        if long_name in PUSH_LONG_OPTIONS_WITH_VALUE and "=" not in token:
            index += 2
            continue
        if token.startswith("-") and not token.startswith("--") and len(token) > 1:
            cluster = token[1:]
            for offset, option in enumerate(cluster):
                if option == "f":
                    return token
                if option in PUSH_SHORT_OPTIONS_WITH_VALUE:
                    if offset == len(cluster) - 1:
                        index += 1
                    break
        index += 1
    return None


def forbidden_gh_operation(segment: list[str]) -> str | None:
    index = executable_index(segment)
    if index is None or os.path.basename(segment[index]) != "gh":
        return None
    index += 1

    words: list[str] = []
    while index < len(segment) and len(words) < 2:
        token = segment[index]
        if token == "--":
            index += 1
            continue
        if token in GH_OPTIONS_WITH_VALUE:
            index += 2
            continue
        if token.startswith("-"):
            index += 1
            continue
        words.append(token)
        index += 1

    if len(words) == 2 and (words[0], words[1]) in GH_FORBIDDEN_SUBCOMMANDS:
        return f"gh {words[0]} {words[1]}"
    return None


def forbidden_remote_operation(segment: list[str]) -> str | None:
    push = git_subcommand_arguments(segment, "push")
    if push is not None:
        flag = forbidden_push_flag(push)
        if flag:
            return f"git push {flag}"
    return forbidden_gh_operation(segment)


def strip_heredoc_bodies(command: str) -> str:
    """Remove heredoc BODIES, keeping the command skeleton.

    `shlex` has no heredoc model, so an unquoted body is lexed as ordinary command text —
    a single apostrophe in English prose ("doesn't") opens a quote that never closes and
    tokenizing raises ValueError. Bodies are never policy-relevant: only the command line
    around them is. Stripping them lets a `cat > notes.md <<'EOF' … EOF` call tokenize.

    A body is stripped ONLY when its terminator is actually found. Dropping to end-of-input
    instead deleted the rest of the command every time HEREDOC_OPENER fired on something that
    was not an opener — `echo "a << b"` reads as a heredoc for delimiter `b` — so a
    `git commit --amend` on a LATER line was deleted before anything could check it. That was
    latent while this ran only on the unparseable path; it became a live bypass the moment
    check_command() started stripping on the success path too. Measured: three separate
    `--amend`/long-subject commands turned into exit 0.
    """
    lines = command.split("\n")
    kept: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        kept.append(line)
        index += 1
        match = HEREDOC_OPENER.search(line)
        if not match:
            continue
        delimiter = match.group(2)
        end = index
        while end < len(lines) and lines[end].strip() != delimiter:
            end += 1
        if end >= len(lines):
            # No terminator: this is not a body we can delimit, so keep every line rather
            # than swallow the remainder of the command line.
            continue
        kept.append(lines[end])  # keep the terminator so structure survives
        index = end + 1
    return "\n".join(kept)


def unparseable_fallback(command: str, error: Exception) -> int:
    """Decide policy for a command that cannot be tokenized even after stripping heredocs.

    Returning 2 here — as this script used to — denies EVERY Bash call the lexer chokes on,
    including commands with no `git` in them at all. That is a repo-wide outage triggered by
    an apostrophe. Fail OPEN instead, after a narrow textual scan for the two flags that are
    hard-forbidden. The subject check is skipped, consistent with this script's stated rule
    of skipping whatever it cannot read rather than guessing.
    """
    # Scan the heredoc-STRIPPED text: a commit message body is data, not an invocation, and
    # a body quoting `--amend` must not read as one.
    if FORBIDDEN_FALLBACK.search(strip_heredoc_bodies(command)):
        print(
            "Blocked by .agents/rules/commit.md: forbidden git commit flag detected "
            "(command could not be fully parsed).",
            file=sys.stderr,
        )
        return 2
    print(f"commit-policy: skipping unparseable command ({error})", file=sys.stderr)
    return 0


def resolve_long_option(name: str) -> str | None:
    """Resolve a possibly-abbreviated long option the way git's parse-options does.

    Exact spellings win outright; otherwise a prefix must match exactly ONE option to be
    unambiguous. `--mess` -> `--message`; `--fi` matches both `--file` and `--fixup`, so git
    would reject it and this returns None.
    """
    if name in COMMIT_LONG_OPTIONS:
        return name
    if not name.startswith("--") or len(name) <= 2:
        return None
    matches = [option for option in COMMIT_LONG_OPTIONS if option.startswith(name)]
    return matches[0] if len(matches) == 1 else None


def heredoc_body_from_raw(command: str, delimiter: str) -> str | None:
    """Read a heredoc body out of the ORIGINAL command text.

    The shlex token cannot be used: it has already had embedded quotes consumed as quoting
    syntax and stripped, which shortened the measured subject by one per quote. The raw text
    is what git will actually receive.

    The SUBSTITUTION-form opener wins over a bare one. `EOF` is the near-universal delimiter,
    so "write the cycle note, then commit" — one command line holding `cat > note.md <<'EOF'`
    and then `git commit -m "$(cat <<EOF …)"` — matched the DOC's opener first and measured
    the note's first line as the commit subject. A long note line then blocked a commit whose
    real subject was short: a false block, in the shape an autonomous run produces every
    cycle. Only `$(cat <<…` can be the message, so prefer it and fall back to the bare
    opener for any form this does not recognise.
    """
    substitution = re.compile(
        r"\$\(\s*cat\s*<<-?\s*(['\"]?)" + re.escape(delimiter) + r"\1"
    )
    opener = re.compile(r"<<-?\s*(['\"]?)" + re.escape(delimiter) + r"\1")
    match = substitution.search(command) or opener.search(command)
    if not match:
        return None
    after_opener = command[match.end():].split("\n")[1:]
    body: list[str] = []
    for line in after_opener:
        if line.strip() == delimiter:
            return "\n".join(body)
        body.append(line)
    return "\n".join(body)  # unterminated heredoc — take what is there


def first_paragraph(text: str) -> str | None:
    """git's `%s`: the first PARAGRAPH, newlines folded to single spaces.

    Taking only the first LINE under-measured any subject written without a blank line
    before its body, and returned "" for a message starting with a newline.
    """
    collected: list[str] = []
    for line in text.split("\n"):
        if not line.strip():
            if collected:
                break
            continue
        collected.append(line.strip())
    return " ".join(collected) if collected else None


def commit_messages(args: list[str]) -> tuple[list[str], bool]:
    """Return (-m/--message values in order, determinable).

    determinable is False when an option supplies the message from a source this script
    cannot read; the caller must then skip the subject check entirely.
    """
    messages: list[str] = []
    index = 0
    while index < len(args):
        token = args[index]
        if token == "--":
            break
        long_name = token.split("=", 1)[0]

        if token.startswith("--"):
            resolved = resolve_long_option(long_name) or long_name
            if resolved in OPAQUE_LONG_OPTIONS:
                return [], False
            if resolved == "--message":
                if "=" in token:
                    messages.append(token.split("=", 1)[1])
                    index += 1
                else:
                    if index + 1 < len(args):
                        messages.append(args[index + 1])
                    index += 2
                continue
            if resolved in COMMIT_LONG_OPTIONS_WITH_VALUE and "=" not in token:
                index += 2
                continue
            index += 1
            continue

        if token.startswith("-") and len(token) > 1:
            cluster = token[1:]
            consumed_next = False
            for offset, option in enumerate(cluster):
                if option in OPAQUE_SHORT_OPTIONS:
                    return [], False
                if option == "m":
                    rest = cluster[offset + 1 :]
                    if rest:
                        messages.append(rest)
                    elif index + 1 < len(args):
                        messages.append(args[index + 1])
                        consumed_next = True
                    break
            index += 2 if consumed_next else 1
            continue

        index += 1
    return messages, True


def subject_of(message: str, command: str) -> str | None:
    """The commit subject, or None when it cannot be resolved statically."""
    heredoc = HEREDOC_SUBSTITUTION.match(message.strip())
    if heredoc:
        body = heredoc_body_from_raw(command, heredoc.group(2))
        return first_paragraph(body) if body is not None else None
    if UNRESOLVABLE.search(message):
        return None
    return first_paragraph(message)


def oversized_subject(args: list[str], command: str) -> str | None:
    messages, determinable = commit_messages(args)
    if not determinable or not messages:
        return None
    # git joins repeated -m as paragraphs and `cleanup=whitespace` drops empty ones, so the
    # subject is the first NON-EMPTY message, not blindly the first.
    for message in messages:
        subject = subject_of(message, command)
        if subject:
            return subject if len(subject) > SUBJECT_LIMIT else None
    return None


def check_command(command: str, depth: int = 0, raw: str | None = None) -> int:
    """`raw` is the ORIGINAL text a heredoc body is read out of, and it stays the OUTERMOST
    command line as this recurses into `bash -c` / `eval` payloads — once the skeleton has
    been stripped, that is the only place the body still exists verbatim.
    """
    if not command or depth > MAX_SHELL_NESTING:
        return 0
    if raw is None:
        raw = command
    # Strip heredoc BODIES before segmenting, not only after a tokenize failure. `\n` is a
    # segment separator, so on the successful-parse path every body LINE became its own
    # command segment: a document whose prose began `git commit --amend …` was read as an
    # invocation and hard-blocked, as were `git push --force` and `gh pr create` prose and any
    # quoted over-length `-m` subject. Heredoc prose is this repo's normal authoring path
    # (.agents/INFRA-BACKLOG.md §4) and .agents/rules/commit.md is itself such a document, so
    # the gate blocked authoring the very rule it enforces — the false block this script's
    # own docstring says "would stop all work". Found live: the tool call written to test it
    # was refused by it.
    #
    # oversized_subject() keeps reading `raw` below: the skeleton no longer carries the
    # message bytes git will actually receive.
    try:
        segments = command_segments(strip_heredoc_bodies(command))
    except ValueError as error:
        return unparseable_fallback(command, error)

    for segment in segments:
        try:
            payload = shell_payload(segment)
            if payload is None:
                payload = eval_payload(segment)
            if payload is not None:
                if depth >= MAX_SHELL_NESTING:
                    # Out of unwrapping budget. Returning 0 here made a deep enough nest a
                    # free bypass, so fall closed onto the textual scan instead.
                    status = unresolvable_segment(segment, "shell nesting limit reached")
                    if status:
                        return status
                    continue
                # `raw` — NOT the payload — carries down as the heredoc source. The payload
                # token was cut from the STRIPPED skeleton, so a heredoc body inside it is
                # already gone; passing it as its own raw text left `bash -c 'git commit -m
                # "$(cat <<EOF … EOF)"'` with no subject to measure, and a 74-char subject
                # went from blocked to exit 0. The outer raw text still holds that body.
                status = check_command(payload, depth + 1, raw)
                if status:
                    return status
                continue

            remote = forbidden_remote_operation(segment)
            if remote:
                print(
                    f"Blocked by .agents/rules/cycle-orchestration.md §Never, even when "
                    f"authorized: {remote} is forbidden.\n"
                    "Plain `git push` is allowed; rewriting published history and opening or "
                    "merging PRs are not. Ask the user to run it.",
                    file=sys.stderr,
                )
                return 2

            args = commit_arguments(segment)
        except UnresolvedWrapper as error:
            status = unresolvable_segment(segment, str(error))
            if status:
                return status
            continue

        if args is None:
            continue
        blocked = forbidden_flag(args)
        if blocked:
            print(f"Blocked by .agents/rules/commit.md: git commit flag {blocked} is forbidden.", file=sys.stderr)
            return 2
        oversized = oversized_subject(args, raw)
        if oversized:
            print(
                f"Blocked by .agents/rules/commit.md: commit subject is {len(oversized)} chars "
                f"(limit {SUBJECT_LIMIT}).\n  {oversized}\n"
                "Shorten the subject; move the detail into the body.",
                file=sys.stderr,
            )
            return 2
    return 0


def main() -> int:
    return check_command(sys.argv[1] if len(sys.argv) > 1 else "")


if __name__ == "__main__":
    raise SystemExit(main())
