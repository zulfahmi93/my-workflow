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
FORBIDDEN_FALLBACK = re.compile(r"--amend\b|--no-verify\b")


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


def strip_heredoc_bodies(command: str) -> str:
    """Remove heredoc BODIES, keeping the command skeleton.

    `shlex` has no heredoc model, so an unquoted body is lexed as ordinary command text —
    a single apostrophe in English prose ("doesn't") opens a quote that never closes and
    tokenizing raises ValueError. Bodies are never policy-relevant: only the command line
    around them is. Stripping them lets a `cat > notes.md <<'EOF' … EOF` call tokenize.
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
        while index < len(lines) and lines[index].strip() != delimiter:
            index += 1
        if index < len(lines):
            kept.append(lines[index])  # keep the terminator so structure survives
            index += 1
    return "\n".join(kept)


def unparseable_fallback(command: str, error: Exception) -> int:
    """Decide policy for a command that cannot be tokenized even after stripping heredocs.

    Returning 2 here — as this script used to — denies EVERY Bash call the lexer chokes on,
    including commands with no `git` in them at all. That is a repo-wide outage triggered by
    an apostrophe. Fail OPEN instead, after a narrow textual scan for the two flags that are
    hard-forbidden. The subject check is skipped, consistent with this script's stated rule
    of skipping whatever it cannot read rather than guessing.
    """
    if "commit" in command and FORBIDDEN_FALLBACK.search(command):
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
    """
    opener = re.compile(r"<<-?\s*(['\"]?)" + re.escape(delimiter) + r"\1")
    match = opener.search(command)
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


def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if not command:
        return 0
    try:
        segments = command_segments(command)
    except ValueError as first_error:
        # Almost always a heredoc body shlex mis-lexed — strip bodies and retry before
        # concluding anything. Only the skeleton matters for commit policy.
        try:
            segments = command_segments(strip_heredoc_bodies(command))
        except ValueError:
            return unparseable_fallback(command, first_error)

    for segment in segments:
        args = commit_arguments(segment)
        if args is None:
            continue
        blocked = forbidden_flag(args)
        if blocked:
            print(f"Blocked by .agents/rules/commit.md: git commit flag {blocked} is forbidden.", file=sys.stderr)
            return 2
        oversized = oversized_subject(args, command)
        if oversized:
            print(
                f"Blocked by .agents/rules/commit.md: commit subject is {len(oversized)} chars "
                f"(limit {SUBJECT_LIMIT}).\n  {oversized}\n"
                "Shorten the subject; move the detail into the body.",
                file=sys.stderr,
            )
            return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
