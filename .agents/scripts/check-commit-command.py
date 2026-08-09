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
import posixpath
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
# `<` and `>` are punctuation so a SPACELESS redirect splits into operator + target.
# Without them `printf '[core]\nhooksPath = /dev/null\n' >>.git/config` lexes `>>.git/config`
# as ONE word and no redirect rule can see the target — measured, and it is the same hole
# check-generated-command.py fixed for `>docs/html/…` (#20). They must NOT join CONTROL: a
# redirect operator is not a segment separator, and treating one as a separator cuts
# `cmd >file` in half, stranding the target in a segment with no command word.
PUNCTUATION = ";&|()\n<>"
# shlex must stop treating \n as whitespace or it would never emit it as a token.
LEXER_WHITESPACE = " \t\r"
# Operators whose following word is a file the shell TRUNCATES or APPENDS to.
REDIRECT = re.compile(r"^[0-9]*(>>?\|?|>&|&>>?)$")
# Operators whose following word the shell never writes to — input redirects, heredoc and
# here-string markers, fd duplications. They are skipped WITH their operand so the operand
# cannot be mistaken for a command operand: without this `tee /tmp/copy < .git/config`, which
# only READS the file, would be convicted by the tee rule below.
READ_REDIRECT = re.compile(r"^[0-9]*<(<<?|&)?$")
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

# Heredoc openers are NOT found with a regex — see heredoc_openers(). A regex cannot tell
# `cat <<EOF` from the `<<` inside `echo "a << b"`, and reading the second as an opener
# deleted every line up to the next line spelling `b`. Measured: that swallowed a
# `git push --force origin main` sitting between them and the gate exited 0.

# Last-resort scan when the command cannot be tokenized at all.
#
# This must match an actual `git … commit … --amend` shape, NOT the bare flag. The earlier
# `"commit" in command and (--amend|--no-verify)` substring pair fired on any unparseable
# command that merely MENTIONED both — `echo it doesn't commit; grep -- --amend f` was
# blocked live. That is a fail-CLOSED path inside a function whose whole contract is to
# fail open. Requiring git + commit + the flag with no command separator between them keeps
# the real bypass covered and drops the prose false positives.
#
# `\b` was too weak an edge. `\b` treats `-` and `.` as boundaries, so a FILENAME that packs
# all three words into one token matched: `open docs/git-commit--amend-notes.md` was blocked,
# reported live by review. An argv word is delimited by whitespace, not by hyphens, so the
# edges are widened to reject a neighbouring word character, `.` or `-`.
#
# `/` is deliberately still allowed as a leading neighbour: `caffeinate /usr/bin/git commit
# --amend` reaches this scan (caffeinate is not a modelled executable) and an absolute path to
# git must keep matching. The TRAILING edge is what disqualifies `docs/git-commit…`, and it
# does so on all three words independently.
WORD_EDGE = r"[\w.\-]"
FORBIDDEN_FALLBACK = re.compile(
    rf"(?<!{WORD_EDGE})git(?!{WORD_EDGE})[^\n;&|]*"
    rf"(?<!{WORD_EDGE})commit(?!{WORD_EDGE})[^\n;&|]*?"
    rf"(?:--amend|--no-verify)(?!{WORD_EDGE})"
)

# A token holding whitespace was quoted, so it is data — see segment_text().
QUOTED_DATA = re.compile(r"\s")

# FORBIDDEN_FALLBACK is anchored on `\bgit\b`, so a segment whose text has no `git` word in
# it cannot possibly match. Checking that first keeps the "skipping unresolvable command"
# notice off every `ls`, `npm test` and `node x.js` — which is now the common case, because
# EVERY unrecognised executable routes through unresolvable_segment(). The DECISION is
# identical either way; only the notice is suppressed.
GIT_WORD = re.compile(r"\bgit\b")


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
    lexer = shlex.shlex(
        normalise_ansi_c_quotes(command), posix=True, punctuation_chars=PUNCTUATION
    )
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


def segment_text(segment: list[str]) -> str:
    """The segment rendered for the textual scan, with QUOTED DATA neutralised.

    An argv word cannot contain whitespace unless it was quoted, and a quoted word is an
    ARGUMENT to the command — never part of the invocation itself. A plain `" ".join()` made
    `echo "git commit --amend"` render exactly like the invocation `git commit --amend`,
    which is the class of false block FORBIDDEN_FALLBACK's own comment was written to stop.
    That was tolerable while this path ran only on a lexer failure; it is not now that every
    unrecognised executable reaches it, so the multi-word tokens are dropped.

    Dropped to EMPTY rather than to a separator: a real invocation may legitimately carry a
    quoted argument mid-line (`caffeinate git commit -m "some msg" --amend`), and a
    separator there would break the scan's match across it and re-open the hole.
    """
    return " ".join("" if QUOTED_DATA.search(token) else token for token in segment)


def unresolvable_segment(segment: list[str], reason: str) -> int:
    """Policy for one segment this script could not resolve down to an executable.

    Fails open like unparseable_fallback(), behind the same narrow textual scan — but over
    the SEGMENT rather than the whole command, so one unresolvable segment cannot make a
    sibling `echo "git commit --amend"` read as an invocation.
    """
    if FORBIDDEN_FALLBACK.search(segment_text(segment)):
        print(
            "Blocked by .agents/rules/commit.md: forbidden git commit flag detected "
            f"({reason}).",
            file=sys.stderr,
        )
        return 2
    print(f"commit-policy: skipping unresolvable command ({reason})", file=sys.stderr)
    return 0


def nesting_limit_reached() -> int:
    """Policy for a command nested deeper than this script will unwrap: BLOCK.

    Every other "cannot resolve" path in this file fails open behind a textual scan, and that
    is defensible because the thing it cannot resolve is usually an ordinary command. This one
    is different in kind: the depth is chosen by whoever wrote the command line, so a fail-open
    here is a bypass ANY caller can reach on demand by adding one more `bash -c`. There is no
    legitimate command in this repo's workflows wrapped four shells deep — verified against the
    whole allow-list in .agents/scripts/test-agent-config.mjs, which peaks at one.
    """
    print(
        f"Blocked by .agents/rules/commit.md: command nests shell wrappers more than "
        f"{MAX_SHELL_NESTING} deep, so this gate cannot analyse what it runs.\n"
        "Simplify the command — run it without the extra `bash -c` / `eval` layers.",
        file=sys.stderr,
    )
    return 2


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
# A force push does not need a force FLAG, and neither does a deletion. `--mirror` rewrites
# EVERY ref under refs/ on the remote and removes the ones absent locally — strictly worse
# than `--force` on one branch — while `--delete` removes the named refs outright. Both were
# exit 0 with empty stderr, which is why the flag-only check was decorative: `git push
# origin +main` is the same operation as `git push --force origin main`, spelled in the
# refspec instead. See forbidden_refspec() for the two positional spellings.
#
# `--prune` joined them: it deletes every remote branch with no local counterpart, so
# `git push --prune origin 'refs/heads/*:refs/heads/*'` removes published branches with no
# force flag, no `--delete` and no `:refspec`. MEASURED in a throwaway repo pair — a branch
# present on the remote and absent locally came back `- [deleted]`.
DESTRUCTIVE_PUSH_TARGETS = ("--mirror", "--delete", "--prune")
# `--no-verify` turns OFF the pre-push hook — the layer that owns destructiveness detection,
# because only it sees resolved refs. A push that disables its own enforcement has to be
# stopped here, at the one layer where the intent is still visible as text. This is the single
# place where `git push` stops being unconditionally advisory: plain `git push` stays open (it
# is what deploys zulfahmi.dev), and only the hook-disabling spelling is refused.
HOOK_DISABLING_PUSH_TARGETS = ("--no-verify",)
PUSH_FORBIDDEN_LONG_TARGETS = frozenset(
    FORCE_PUSH_TARGETS + DESTRUCTIVE_PUSH_TARGETS + HOOK_DISABLING_PUSH_TARGETS
)
# Short forms that mean the same: `-f` = --force, `-d` = --delete. NOT `-n`: for `git push`,
# `-n` is `--dry-run`, not `--no-verify`. (`git push -h` confirms it.)
PUSH_FORBIDDEN_SHORT_OPTIONS = frozenset({"f", "d"})
PUSH_SHORT_OPTIONS_WITH_VALUE = {"o"}

# `git push`'s COMPLETE long-option set, name -> takes a SEPARATE value. Transcribed from
# `git push -h` (git 2.54.0) and verified option by option in a throwaway repo pair.
#
# The whole set has to be here, not just the forbidden names, because git resolves an
# abbreviation against the whole set: a prefix binds only when it matches exactly one option.
# The previous `len(long_name) >= 4` floor was a stand-in for that rule and got it wrong in
# BOTH directions. `--m` is 3 chars and git resolves it to `--mirror` and performs a real
# mirror push (measured: the throwaway remote was rewritten), so the floor let the single
# worst push form through on one letter. It is a floor on LENGTH, but ambiguity has nothing to
# do with length — `--forc` is 6 and git rejects it as ambiguous.
#
# Value-taking-ness matters for the walk: `--pu ci.skip origin main` resolves to
# `--push-option`, which eats `ci.skip`. Read as valueless, `ci.skip` becomes a positional and
# the refspec screen would look at the wrong slot. `--signed` and `--force-with-lease` take an
# OPTIONAL value and only in the attached `=` form — verified: `--signed yes` leaves `yes` as
# a positional — so they are False here.
PUSH_LONG_OPTIONS = {
    "--verbose": False, "--quiet": False, "--repo": True, "--all": False,
    "--branches": False, "--mirror": False, "--delete": False, "--tags": False,
    "--dry-run": False, "--porcelain": False, "--force": False,
    "--force-with-lease": False, "--force-if-includes": False,
    "--recurse-submodules": True, "--thin": False, "--receive-pack": True,
    "--exec": True, "--set-upstream": False, "--progress": False, "--prune": False,
    "--no-verify": False, "--verify": False, "--follow-tags": False, "--signed": False,
    "--atomic": False, "--push-option": True, "--ipv4": False, "--ipv6": False,
}
# `--[no-]X` in the help text means `--no-X` parses too, and it is part of the namespace an
# abbreviation is resolved against — without these, `--no-v` would look unambiguous here while
# git calls it ambiguous (`could be --no-verbose or --no-verify`). Every one is the DISABLING
# form, so none of them is forbidden: `--no-mirror` and `--no-force` turn the danger off.
# `--verify` is already the listed opposite of `--no-verify`, and there is no `--no-ipv4`.
PUSH_LONG_OPTIONS.update(
    {
        f"--no-{name[2:]}": False
        for name in (
            "--verbose", "--quiet", "--repo", "--all", "--branches", "--mirror",
            "--delete", "--tags", "--dry-run", "--porcelain", "--force",
            "--force-with-lease", "--force-if-includes", "--recurse-submodules",
            "--thin", "--receive-pack", "--exec", "--set-upstream", "--progress",
            "--prune", "--follow-tags", "--signed", "--atomic", "--push-option",
        )
    }
)

GH_OPTIONS_WITH_VALUE = {
    "--repo", "-R", "--method", "-X", "--field", "-f", "--raw-field", "-F",
    "--header", "-H", "--input", "--hostname", "--jq", "-q", "--template", "-t",
    "--cache", "--preview", "-p",
}
GH_METHOD_OPTIONS = {"--method", "-X"}
# `gh repo delete` destroys the repository; `gh release delete` removes a published release.
GH_FORBIDDEN_SUBCOMMANDS = {
    ("pr", "create"), ("pr", "merge"), ("repo", "delete"), ("release", "delete"),
}
# `gh api --method DELETE /repos/OWNER/REPO/git/refs/heads/main` deletes a published branch
# over the REST API. It is the same operation as `git push origin :main` — which is blocked —
# except that it never touches a local repository, so the pre-push hook can NEVER see it.
# Nothing downstream of this gate observes it at all.
GH_DESTRUCTIVE_API_METHODS = {"DELETE"}
# Against a `git/refs` path these REWRITE a ref: PATCH is the API spelling of a force push
# (it takes `force=true`), and POST/PUT create or replace one. Against any other path they are
# ordinary writes (opening an issue, editing a comment) and stay open.
GH_REF_WRITE_API_METHODS = {"PATCH", "POST", "PUT"}
GH_REF_PATH = re.compile(r"(?i)(?:^|/)git/refs(?:/|$)")

# `git -c core.hooksPath=/dev/null push origin main` is a PLAIN push — no forbidden flag, no
# forbidden refspec — that runs with every hook in the repository switched off. It is the
# `--no-verify` hole spelled as configuration, and .agents/rules/cycle-orchestration.md §251
# already names the pair as the combination that passes both layers. `--config-env` sets the
# same key from an environment variable, so the value can arrive in either token.
# Config keys are case-insensitive in git, hence the (?i).
HOOKS_PATH_OVERRIDE = re.compile(r"(?i)(?:^|=)core\.hookspath=")

# The PERSISTED spelling of the same override, and the keystone of this whole round. `git -c
# core.hooksPath=…` lasts one command; `git config core.hooksPath …` writes the key into the
# repository (or the user's global) config, so EVERY later git command in that repo runs with
# hooks off and no command line ever mentions it again — including the pre-push hook, the one
# layer that sees RESOLVED refs and therefore does not care how a push was spelled. Without
# this rule, installing that hook guarantees nothing.
#
# Git config keys are case-insensitive, so `Core.HooksPath` is the same key; the `.` separator
# is not, which is why this is anchored rather than a substring search.
HOOKS_PATH_KEY = re.compile(r"(?i)^core\.hookspath$")
# Reads change nothing and stay open: `git config --get core.hooksPath` and `--list` are how
# you AUDIT the setting, and a gate that blocks its own audit is pure cost.
CONFIG_READ_ACTIONS = {
    "--get", "--get-all", "--get-regexp", "--get-urlmatch", "--get-color", "--get-colorbool",
    "--list", "-l",
}
# DECISION: `--unset`/`--unset-all` are blocked WITH the writes, and this was measured rather
# than assumed. .agents/scripts/install-git-hooks.sh installs into `git rev-parse --git-path
# hooks`, and that path HONOURS core.hooksPath (git 2.54: with the key set to /tmp/elsewhere it
# printed `/tmp/elsewhere`, and printed `.git/hooks` again after `--unset`). So in the layout
# the installer actually produces, unsetting the key moves git off the directory holding the
# installed pre-push hook — an unset is a DISABLE, not a restore. Which of the two it is
# depends on repository state this parser never reads, so it takes the safe reading. The
# restorative act has a spelling that stays open: re-run the installer.
CONFIG_UNSET_ACTIONS = {"--unset", "--unset-all"}
# `git config` options that consume a SEPARATE value. Without them `--file /tmp/c
# core.hooksPath /dev/null` reads `/tmp/c` as the key and `core.hooksPath` as the value, and
# the key-then-value shape below never matches.
CONFIG_OPTIONS_WITH_VALUE = {"--file", "-f", "--blob", "--type", "-t", "--default", "--comment"}
# The options that choose WHICH config file `git config` edits. `--file`/`-f` is the one that
# can name a file this gate would otherwise never see mentioned.
CONFIG_FILE_OPTIONS = {"--file", "-f", "--blob"}
CONFIG_EDIT_ACTIONS = {"--edit", "-e"}

# ── A git CONFIG FILE as a WRITE TARGET ───────────────────────────────────────────────────
#
# `printf '[core]\nhooksPath = /dev/null\n' >> .git/config` sets core.hooksPath without running
# a single git command. EVERY rule above reads a git COMMAND LINE, so all of them are blind to
# it — measured at exit 0 — and it switches the pre-push hook off outright, which makes it the
# keystone: without this rule, installing that hook guarantees nothing.
#
# Matched on the PATH, not on the content, because the content is usually unreadable here (it
# is a quoted argument, an editor session, or another file). Covered spellings:
#   .git/config, .git/config.worktree, .git/modules/<name>/config  — one repository
#   ~/.gitconfig, /etc/gitconfig, $XDG_CONFIG_HOME/git/config      — EVERY repository at once
# The global ones matter as much as the local one: a global core.hooksPath disables the hook in
# all nine repositories in this monorepo simultaneously.
#
# `(?i)` is not cosmetic and not about git's own case rules — it is about the FILESYSTEM. macOS
# is case-insensitive by default, so `.GIT/config` opens the very same file, and the operator
# confirmed it resolves. Compiled case-sensitively, this pattern let the keystone bypass through
# spelled in capitals: `printf '[core]\nhooksPath = /dev/null\n' >> .GIT/config` was exit 0 —
# the one hole round 4 existed to close, still open one Shift key away.
GIT_CONFIG_PATH = re.compile(
    r"(?i)(?:^|/)(?:"
    r"\.git/(?:.+/)?config(?:\.worktree)?"  # a repository config, incl. .git/modules/<n>/config
    r"|\.gitconfig"                         # ~/.gitconfig
    r"|etc/gitconfig"                       # /etc/gitconfig, <brew prefix>/etc/gitconfig
    r"|git/config"                          # $XDG_CONFIG_HOME/git/config, ~/.config/git/config
    r")$"
)
# The bare `gitconfig` alternative is deliberately anchored to an `etc/` parent rather than
# matching any last component spelled `gitconfig`. `/etc/gitconfig` is the path this git
# actually reads (measured: `git config --list --system` reports exactly that file), while an
# ordinary `docs/gitconfig` or `x.gitconfig` is not a git config file at all and blocking a
# write to one is pure cost. `x.gitconfig` never matched — `(?:^|/)` cannot start mid-word — and
# now `docs/gitconfig` does not either.

# `.git/hooks/*` — the HOOK FILE ITSELF, which round 4's rules did not cover at all.
#
# Every rule above defends the switch that turns hooks off (`core.hooksPath`, and the config
# file it is written into). None of them defends the hook. Overwriting `.git/hooks/pre-push` is
# the same end state as pointing core.hooksPath at /dev/null, one step more direct, and it was
# exit 0 in seven spellings — `>`, `rm`, `chmod -x`, `ln -sf`, `truncate`, `mv`, `sed -i`. The
# Bash gate scoped to git CONFIG files and the Edit/Write hook covers only the tool surface, so
# the shell was an open door to the layer that sees RESOLVED refs.
#
# Matches the directory itself as well as anything under it, so a destination that is the
# DIRECTORY (`cp /tmp/x .git/hooks/`, `rm -rf .git/hooks`) is covered too. `.git/modules/<n>/`
# and `.git/worktrees/<n>/` hook directories come in on the same middle-segment wildcard the
# config pattern uses. Case-insensitive for the same measured reason as GIT_CONFIG_PATH.
GIT_HOOKS_PATH = re.compile(r"(?i)(?:^|/)\.git/(?:.+/)?hooks(?:/|$)")

# Command words whose EVERY non-flag operand is a file they write.
CONFIG_WRITE_ALL_OPERANDS = {"tee"}
# Command words whose LAST operand is the destination.
CONFIG_WRITE_DEST_LAST = {"cp", "mv", "install"}
# `cp -t DIR SRC…` / `install -t` / `mv -t` put the destination in an OPTION, which inverts the
# rule above: the last operand is then a SOURCE. Measured both ways — `cp -t .git/ /tmp/config`
# was exit 0 (the write was invisible), and the mirror image `cp -t /tmp .git/config` is a pure
# READ that a naive last-operand rule convicts. So the option is parsed rather than skipped.
TARGET_DIRECTORY_OPTIONS = {"-t", "--target-directory"}
# Verbs that DESTROY or REPLACE a file without writing bytes into it. Only the hooks rule uses
# them: an unlinked, emptied, un-executable or symlinked-away pre-push hook stops running, which
# is the whole objective, and none of these can express a config directive.
HOOKS_DESTROY_ALL_OPERANDS = {"rm", "unlink", "truncate", "chmod", "shred"}
# `mv` removes its SOURCE as well as writing its destination, so moving the hook away disables
# it just as surely as overwriting it. `cp` and `install` read their sources, so only their
# destination is a write.
HOOKS_MOVE = {"mv"}
# `ln`/`ln -s` replaces the link NAME, which is its last operand (or the `-t` directory).
HOOKS_LINK = {"ln"}

# The ENVIRONMENT spelling. `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath
# GIT_CONFIG_VALUE_0=/dev/null git push origin main` sets the key for that one git process
# with no `-c` and no `git config` anywhere on the line — executable_index() skips leading
# assignments precisely so it can find the executable behind them, so this walked straight
# through every rule above.
GIT_CONFIG_KEY_ENV = re.compile(r"(?i)^GIT_CONFIG_KEY_\d+=(.*)$", re.DOTALL)
# `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` REDIRECT git at a different config file, which can
# set core.hooksPath in its own right — and this gate cannot read that file. Blocked when the
# value could be such a file; left open for the sinks that provably cannot contain a directive,
# because pointing both at /dev/null is the standard test-isolation idiom and is used by
# .agents/scripts/test-git-hooks.sh:39.
GIT_CONFIG_FILE_ENV = re.compile(r"(?i)^(GIT_CONFIG_GLOBAL|GIT_CONFIG_SYSTEM)=(.*)$", re.DOTALL)
CONFIG_FILE_SINKS = {"", "/dev/null"}
# `export`/`declare -x` set a variable for LATER segments, so the assignment need not sit on
# the git command at all.
EXPORT_BUILTINS = {"export", "declare", "typeset"}

# Subcommands that take an arbitrary command and RUN it. A `git` segment whose subcommand is
# one of these is a wrapper around another command exactly the way `bash -c` is, so its operand
# has to be checked rather than trusted. `git submodule foreach git commit --amend` was exit 0:
# the executable IS git, so the "unrecognised executable" textual fallback was skipped by its
# `name != "git"` guard, and the subcommand is not `commit`, so nothing else looked either.
GIT_COMMAND_RUNNING_SUBCOMMANDS = {"submodule", "bisect", "rebase", "filter-branch"}

# A git alias is a stored command run later as `git <alias>`, and at that point no textual rule
# can tell it from any other subcommand. Creation is the only moment it is visible, so the
# forbidden bodies are refused there. Gated on `git config` + an `alias.` key, which is why it
# can read a QUOTED operand without reopening the `echo "git commit --amend"` false-positive
# class: for this one subcommand the quoted operand really is a command.
ALIAS_KEY = re.compile(r"(?i)^alias\.")
FORBIDDEN_ALIAS_BODY = re.compile(
    r"(?:\bcommit\b[^\n;&|]*?(?:--amend|--no-verify)"
    r"|\bpush\b[^\n;&|]*?(?:--force|--mirror|--delete|--prune|--no-verify))"
)


def forbidden_refspec(token: str) -> str | None:
    """The two POSITIONAL spellings of a forbidden push, or None.

    `+<src>:<dst>` is git's per-refspec force marker — `git push origin +main` is a force
    push with no force flag anywhere on the line. An EMPTY source side (`:main`) pushes
    nothing to the destination, which is how git spells "delete that remote branch".

    Anchored on the FIRST character on purpose. A colon later in the token is ordinary:
    `git push git@github.com:owner/repo.git main` carries one in the repository URL, and
    `main:refs/heads/main` is a perfectly normal refspec. Only an empty left side deletes.
    """
    if token.startswith("+"):
        return token
    if token.startswith(":"):
        return token
    return None


def resolve_push_option(name: str) -> tuple[str | None, list[str]]:
    """Resolve a `git push` long option the way git's parse-options resolves it.

    Returns (resolved name or None, every option the prefix could name). An EXACT spelling
    binds immediately even when it is also a prefix of longer options — measured: `--force` is
    accepted while `--forc` is rejected as ambiguous between `--force-with-lease` and
    `--force-if-includes`. Otherwise a prefix binds only when exactly one option starts with
    it, which is why `--m` IS `--mirror` (nothing else starts with `m`) while `--d` is nobody
    (`--delete` and `--dry-run`) and `--dr` is `--dry-run`. All four verified against git.
    """
    if name in PUSH_LONG_OPTIONS:
        return name, [name]
    if not name.startswith("--") or len(name) <= 2:
        return None, []
    candidates = sorted(
        option for option in PUSH_LONG_OPTIONS if option.startswith(name)
    )
    if len(candidates) == 1:
        return candidates[0], candidates
    return None, candidates


def forbidden_push_argument(args: list[str]) -> str | None:
    """The first `git push` argument this policy forbids, or None.

    Covers both halves of the operation, because the flag half alone was trivially routed
    around: the FLAGS (`--force*`, `-f`, `--mirror`, `--delete`, `-d`) and the POSITIONAL
    refspec forms that do the same thing without one (see forbidden_refspec()).

    Positionals are read as refspecs only where they really are positionals. The
    option-with-value tables are honoured first, so the `+` in `--push-option=+ci.skip` and
    in `-o +foo` stays a VALUE — misreading either as a refspec would block ordinary CI
    pushes, and a policy agents learn to route around protects nothing.
    """
    index = 0
    # Everything after `--` is a positional operand — git stops parsing options there. The
    # old code `return None`d on `--`, so `git push origin -- +main` was a free force push.
    positional_only = False
    while index < len(args):
        token = args[index]
        if token == "--":
            positional_only = True
            index += 1
            continue

        if not positional_only and token.startswith("-") and len(token) > 1:
            long_name = token.split("=", 1)[0]
            if token.startswith("--"):
                resolved, candidates = resolve_push_option(long_name)
                # Blocked when ANY option the prefix could name is forbidden, not only when the
                # prefix is unambiguous. Two reasons, and neither costs a legitimate push:
                #   * git refuses an ambiguous prefix itself (`--forc` -> "ambiguous option",
                #     exit 129, nothing pushed), so refusing it here changes no outcome — and
                #     the existing suite already requires `git push --forc origin main` to be
                #     blocked, which the strict unambiguous-only rule would stop doing;
                #   * it is the safe direction under table drift. A git whose option set differs
                #     from PUSH_LONG_OPTIONS can only ever make this table report MORE
                #     candidates than git sees, never fewer, so a prefix git resolves straight
                #     to `--mirror` can never be waved through here as "ambiguous".
                # An EXACT spelling still wins outright, the way git's parse-options does it, so
                # `--verify` and `--no-verbose` stay open despite being prefixes of nothing and
                # neighbours of `--no-verify`.
                if resolved in PUSH_FORBIDDEN_LONG_TARGETS or (
                    resolved is None
                    and any(name in PUSH_FORBIDDEN_LONG_TARGETS for name in candidates)
                ):
                    return token
                if resolved and PUSH_LONG_OPTIONS[resolved] and "=" not in token:
                    index += 2
                    continue
                index += 1
                continue
            cluster = token[1:]
            for offset, option in enumerate(cluster):
                if option in PUSH_FORBIDDEN_SHORT_OPTIONS:
                    return token
                if option in PUSH_SHORT_OPTIONS_WITH_VALUE:
                    if offset == len(cluster) - 1:
                        index += 1
                    break
            index += 1
            continue

        # A positional: `<repository>` then `<refspec>…`. Both slots are screened — a remote
        # name or URL can never start with `+` or `:`, so screening the first one costs
        # nothing and covers `git push +main` (one argument, no remote named).
        refspec = forbidden_refspec(token)
        if refspec:
            return refspec
        index += 1
    return None


def gh_invocation(segment: list[str]) -> tuple[list[str], str | None] | None:
    """(positional words, HTTP method) for a `gh` segment, or None if it is not one.

    The old walker stopped after two positionals and knew only `--repo`/`-R`, so
    `gh api --method DELETE /repos/…` was read as the subcommand pair `("api", "DELETE")` —
    the method VALUE landed in the subcommand slot. Options that take a value have to be
    consumed properly before any positional can be trusted.
    """
    index = executable_index(segment)
    if index is None or os.path.basename(segment[index]) != "gh":
        return None
    index += 1

    words: list[str] = []
    method: str | None = None
    while index < len(segment):
        token = segment[index]
        if token == "--":
            index += 1
            continue
        name = token.split("=", 1)[0]
        if name in GH_METHOD_OPTIONS:
            if "=" in token:
                method = token.split("=", 1)[1]
            elif index + 1 < len(segment):
                method = segment[index + 1]
                index += 1
            index += 1
            continue
        # cobra accepts an attached short value: `-XDELETE`.
        if token.startswith("-X") and len(token) > 2:
            method = token[2:]
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

    return words, method.upper() if method else None


def forbidden_gh_operation(segment: list[str]) -> str | None:
    invocation = gh_invocation(segment)
    if invocation is None:
        return None
    words, method = invocation

    if words and words[0] == "api":
        path = words[1] if len(words) > 1 else ""
        if method in GH_DESTRUCTIVE_API_METHODS:
            return f"gh api --method {method} {path}".rstrip()
        if method in GH_REF_WRITE_API_METHODS and GH_REF_PATH.search(path):
            return f"gh api --method {method} {path}"
        # No method, or GET: `gh api /repos/x/y` is a read and stays open.
        return None

    if len(words) >= 2 and (words[0], words[1]) in GH_FORBIDDEN_SUBCOMMANDS:
        return f"gh {words[0]} {words[1]}"
    return None


def forbidden_git_remote(segment: list[str]) -> str | None:
    """`git remote set-url` — re-points a LATER plain push at a different target.

    Plain `git push origin main` is deliberately open because it is the zulfahmi.dev deploy.
    That permission is only safe while `origin` still means what it meant: rewriting the URL
    turns the allowed command into a push to somewhere else entirely, with nothing in the
    push command itself for this gate or the pre-push hook to object to.

    `get-url` and `-v` are reads and stay open — only the first POSITIONAL is examined, so an
    option in front of the subcommand cannot shift the match.
    """
    args = git_subcommand_arguments(segment, "remote")
    if args is None:
        return None
    for token in args:
        if token.startswith("-"):
            continue
        return "git remote set-url" if token == "set-url" else None
    return None


def forbidden_hooks_path(segment: list[str]) -> str | None:
    """`git -c core.hooksPath=…` / `--config-env=core.hooksPath=…` on any git segment.

    Applied to every git subcommand, not just `push`: the key switches off pre-commit exactly
    as it switches off pre-push, and setting it from a command line has no other purpose.
    Verified by grep that nothing in `.agents/`, `.claude/` or `.codex/` sets it — the only
    mention in the repo is cycle-orchestration.md naming it as this exact hole.
    """
    index = executable_index(segment)
    if index is None or os.path.basename(segment[index]) != "git":
        return None
    index += 1
    while index < len(segment):
        token = segment[index]
        if not token.startswith("-"):
            break  # the subcommand: git's own options are done
        if HOOKS_PATH_OVERRIDE.search(token):
            return f"git {token}"
        if token in GIT_OPTIONS_WITH_VALUE:
            if index + 1 < len(segment) and HOOKS_PATH_OVERRIDE.search(segment[index + 1]):
                return f"git {token} {segment[index + 1]}"
            index += 2
            continue
        index += 1
    return None


def config_invocation(segment: list[str]) -> tuple[list[str], set[str], list[str]] | None:
    """(positionals, action/modifier flags, `--file`-style operands) for a `git config` segment.

    Shared by the two rules that read a `git config` line — the KEY one (core.hooksPath, any
    file) and the FILE one (any key, a git config file) — so the two cannot drift in how they
    consume `--file <f>`, `--type <t>` and the rest. Options taking a SEPARATE value must be
    consumed before any positional is trusted: without that, `--file /tmp/c core.hooksPath
    /dev/null` reads `/tmp/c` as the key.
    """
    args = git_subcommand_arguments(segment, "config")
    if args is None:
        return None

    positionals: list[str] = []
    actions: set[str] = set()
    files: list[str] = []
    index = 0
    while index < len(args):
        token = args[index]
        if token == "--":
            positionals.extend(args[index + 1 :])
            break
        if token.startswith("-") and len(token) > 1:
            name = token.split("=", 1)[0]
            actions.add(name)
            if name in CONFIG_OPTIONS_WITH_VALUE and "=" not in token:
                if name in CONFIG_FILE_OPTIONS and index + 1 < len(args):
                    files.append(args[index + 1])
                index += 2  # its value is not a positional
                continue
            if name in CONFIG_FILE_OPTIONS and "=" in token:
                files.append(token.split("=", 1)[1])
            index += 1
            continue
        positionals.append(token)
        index += 1
    return positionals, actions, files


def forbidden_hooks_path_config(segment: list[str]) -> str | None:
    """`git config … core.hooksPath …` — the persisted hooks-off switch, in any spelling.

    Round 2 closed the per-command `-c core.hooksPath=` form only, so the form that actually
    STICKS was open: `git config core.hooksPath /dev/null` exited 0, as did `--local`,
    `--global` and `--add`. See HOOKS_PATH_KEY for why this one is the keystone.

    Location and modifier flags (`--local`, `--global`, `--system`, `--worktree`, `--file <f>`,
    `--add`, `--replace-all`, `--type <t>`) are order-independent here because the decision is
    made from the POSITIONALS, after the value-taking options have been consumed — so any of
    them may sit before, between or after the key. Reads stay open (CONFIG_READ_ACTIONS).
    """
    invocation = config_invocation(segment)
    if invocation is None:
        return None
    positionals, actions, _files = invocation

    if actions & CONFIG_READ_ACTIONS:
        return None
    for offset, token in enumerate(positionals):
        if not HOOKS_PATH_KEY.match(token):
            continue
        # A key with a VALUE after it is a write. A key ALONE is a read (`git config
        # core.hooksPath` prints it) unless the action itself is destructive — `--unset
        # core.hooksPath` carries no value and still turns the hooks off.
        if offset + 1 < len(positionals) or actions & CONFIG_UNSET_ACTIONS:
            return f"git config {token}"
    return None


def normalised_path(word: str) -> str:
    """`word` as a `/`-separated path with redundant syntax collapsed.

    The two patterns are anchored on `/` boundaries, so any spelling that changes where those
    boundaries fall walks straight past them. `echo x >> .git//config` was exit 0 for exactly
    that reason: `.git//config` never matches `\\.git/(?:.+/)?config$`. `posixpath.normpath`
    collapses repeated slashes and `./` segments, which is the same file to the kernel and the
    same file to git.

    It also resolves `..` TEXTUALLY, which is the right direction here — `x/../.git/config`
    normalises to `.git/config` and starts matching — but it is not a security boundary: a
    symlink makes textual resolution wrong, and this gate never touches the filesystem. The
    posture is the same one is_git_config_path() has always had: match the spellings that can
    be read, leave the ones that cannot (`$CFG`, a command substitution) alone.
    """
    if not word:
        return ""
    return posixpath.normpath(word.replace(os.sep, "/"))


def is_git_config_path(word: str) -> bool:
    """True when `word` names a git config file.

    Matched on the SPELLING, with no filesystem lookup and no expansion. That is deliberate in
    both directions: `$XDG_CONFIG_HOME/git/config` and `~/.gitconfig` still end in the telling
    suffix, so an unexpandable prefix costs nothing; and a target this gate cannot spell out —
    `$CFG`, `"$(git rev-parse --git-path config)"` — is left alone, the same posture every
    other unresolvable value gets here.
    """
    return bool(word) and bool(GIT_CONFIG_PATH.search(normalised_path(word)))


def is_git_hooks_path(word: str) -> bool:
    """True when `word` names a git hooks directory, or anything inside one."""
    return bool(word) and bool(GIT_HOOKS_PATH.search(normalised_path(word)))


def target_directory(words: list[str]) -> str | None:
    """The `-t DIR` / `--target-directory=DIR` destination on a cp/mv/install/ln line, if any.

    Returns None when the option is absent, which is the ordinary case and keeps the
    last-operand rule in charge. When it IS present the last operand is a source, not a
    destination — see TARGET_DIRECTORY_OPTIONS.
    """
    index = 0
    while index < len(words):
        word = words[index]
        if word == "--":
            return None  # only operands follow
        name = word.split("=", 1)[0]
        if name in TARGET_DIRECTORY_OPTIONS:
            if "=" in word:
                return word.split("=", 1)[1]
            return words[index + 1] if index + 1 < len(words) else None
        # Attached (`-t.git/`) and clustered (`-vt DIR`) short forms. Restricted to
        # alphanumeric clusters so a long option can never be mistaken for one.
        if word.startswith("-t") and not word.startswith("--") and len(word) > 2:
            return word[2:]
        if (
            word.startswith("-")
            and not word.startswith("--")
            and len(word) > 2
            and word[1:].isalnum()
            and word.endswith("t")
        ):
            return words[index + 1] if index + 1 < len(words) else None
        index += 1
    return None


def destination_targets(operands: list[str], directory: str | None) -> list[str]:
    """Every path a copy/move/link/install writes, under either destination grammar."""
    if directory is None:
        return operands[-1:]
    return [posixpath.join(directory, posixpath.basename(source)) for source in operands]


def command_operands(segment: list[str]) -> list[str]:
    """The segment minus every redirect operator AND the operand it consumes.

    What is left is the command word and its real operands. Write targets in redirect position
    are resolved separately over the RAW segment, so nothing is lost by dropping them here —
    while KEEPING them would convict `tee /tmp/copy < .git/config`, which is a pure read.
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


def forbidden_config_file_write(segment: list[str]) -> str | None:
    """A write whose TARGET is a git config file, in any spelling this gate can resolve.

    The sibling rules all read a git COMMAND LINE; this one reads a FILE PATH in a write
    position, because the keystone bypass never runs git at all:

        printf '[core]\\nhooksPath = /dev/null\\n' >> .git/config

    That sets core.hooksPath — measured at exit 0 before this rule — and from then on every git
    command in the repository runs with hooks off, including the pre-push hook, which is the
    only layer that sees RESOLVED refs. `git config core.hooksPath` (round 3) and this are the
    same act spelled two ways, and blocking only the spelling that says the key out loud is
    exactly the kind of gate an agent routes around by accident.

    Scoped TIGHTLY to writes, because reads of these files are routine and blocking them would
    be pure cost: `cat .git/config`, `grep hooksPath .git/config`, `git config --get`,
    `git config --list`, `cp .git/config /tmp/backup` and `tee /tmp/copy < .git/config` all
    stay open, and so does a write to any OTHER file.

    Resolved write positions — the same set check-generated-command.py resolves, minus the ones
    that cannot express a config directive:
        >, >>, >|, and the fd forms   the word right after the operator
        tee [-a] TARGET…              every non-flag operand
        sed -i / -i.bak FILE…         every file operand
        cp / mv / install             the LAST operand, or every `-t DIR`/basename destination
        dd of=TARGET
    """
    return first_write_target(segment, is_git_config_path)


def redirect_targets(segment: list[str]) -> list[str]:
    """Paths this segment writes through a REDIRECT or `dd of=`, in order."""
    found: list[str] = []
    for index, word in enumerate(segment):
        if REDIRECT.fullmatch(word) and index + 1 < len(segment):
            found.append(segment[index + 1])
        if word.startswith("of="):
            found.append(word[3:])
    return found


def first_write_target(segment: list[str], matches) -> str | None:
    """The first path this segment WRITES that satisfies `matches`, or None.

    Shared by the git-config rule and the git-hooks rule so the two cannot drift in how a write
    position is resolved — which is exactly how `.git//config` and `cp -t .git/ …` came to be
    open in one of them. `matches` is the only difference between the two callers.
    """
    for target in redirect_targets(segment):
        if matches(target):
            return target

    words = command_operands(segment)
    start = executable_index(words)
    if start is None:
        return None
    name = os.path.basename(words[start])
    arguments = words[start + 1 :]
    operands = [word for word in arguments if not word.startswith("-")]
    directory = target_directory(arguments)
    if directory is not None:
        operands = [word for word in operands if word != directory]

    if name in CONFIG_WRITE_ALL_OPERANDS:
        for word in operands:
            if matches(word):
                return word
    if name == "sed" and any(word.startswith("-i") for word in arguments):
        # `sed -i <script> FILE…` — everything after the script argument is a file operand.
        for word in operands[1:]:
            if matches(word):
                return word
    if name in CONFIG_WRITE_DEST_LAST and operands:
        for word in destination_targets(operands, directory):
            if matches(word):
                return word
    return None


def forbidden_hooks_file_write(segment: list[str]) -> str | None:
    """A write, deletion, truncation, chmod or symlink-replacement inside a `.git/hooks/` dir.

    The gap this closes was UNOWNED: round 4's rules all end at a git CONFIG file, and the
    Edit/Write hook covers only the tool surface, so from a Bash call the pre-push hook FILE was
    wide open. Measured at exit 0 before this rule, every one of them the same end state as
    `core.hooksPath=/dev/null`:

        printf 'exit 0\\n' > .git/hooks/pre-push     rm .git/hooks/pre-push
        chmod -x .git/hooks/pre-push                ln -sf /dev/null .git/hooks/pre-push
        truncate -s 0 .git/hooks/pre-push           mv /tmp/x .git/hooks/pre-push
        sed -i '' s/a/b/ .git/hooks/pre-push        cp -t .git/hooks/ /tmp/pre-push

    READS stay open in full — `cat`, `grep`, `ls`, `diff`, `wc`, `git rev-parse --git-path
    hooks` — for the same reason the config rule leaves reads alone: auditing the hook is how
    you check the gate is real, and a gate that blocks its own audit is pure cost.

    LEGITIMATE HOOK INSTALLATION HAS A SANCTIONED PATH: .agents/scripts/install-git-hooks.sh.
    It runs as a script, so the gate sees `bash .agents/scripts/install-git-hooks.sh` — a
    command with no write verb and no hooks path in a write position — and the writes it makes
    happen inside it, below this layer. Nothing here needs an exemption, and none is granted:
    an exemption keyed on a filename is a filename anyone can type.
    """
    target = first_write_target(segment, is_git_hooks_path)
    if target:
        return target

    words = command_operands(segment)
    start = executable_index(words)
    if start is None:
        return None
    name = os.path.basename(words[start])
    arguments = words[start + 1 :]
    operands = [word for word in arguments if not word.startswith("-")]

    if name in HOOKS_DESTROY_ALL_OPERANDS or name in HOOKS_MOVE:
        # `mv` is in both lists on purpose: first_write_target() already screened its
        # DESTINATION, and this screens its SOURCE, because moving the hook away disables it.
        for word in operands:
            if is_git_hooks_path(word):
                return word
    if name in HOOKS_LINK and operands:
        directory = target_directory(arguments)
        for word in destination_targets(
            [word for word in operands if word != directory], directory
        ):
            if is_git_hooks_path(word):
                return word
    return None


def forbidden_git_config_file(segment: list[str]) -> str | None:
    """`git config --file <a git config file> …` — the FILE spelling of a config write.

    Round 3 blocked the KEY spellings, and the key is not the only way in: with the file named
    explicitly, `git config --file .git/config include.path /tmp/evil` makes git read an
    arbitrary second file, and THAT file can carry core.hooksPath. So the decision here is made
    from the target file plus the presence of a write, not from the key.

    Reads stay open, exactly as they do for the key rule: `git config --file .git/config --get
    core.hooksPath` and `--list` change nothing, and a key with no value is a read too.
    """
    invocation = config_invocation(segment)
    if invocation is None:
        return None
    positionals, actions, files = invocation
    if actions & CONFIG_READ_ACTIONS:
        return None
    # `git config --edit` names no path at all and still opens one — `--global -e` opens
    # ~/.gitconfig. It is only an "interactive" act by convention: EDITOR is a command, so
    # `EDITOR='sed -i …' git config --global --edit` writes core.hooksPath with no editor, no
    # key on the line and no redirect. Nothing in this repo's workflows edits git config in an
    # editor, so refusing it outright costs nothing.
    if actions & CONFIG_EDIT_ACTIONS:
        return "git config --edit"
    if not any(is_git_config_path(path) for path in files):
        return None
    writes = (
        len(positionals) >= 2
        or bool(actions & CONFIG_UNSET_ACTIONS)
        or bool(actions & CONFIG_EDIT_ACTIONS)
    )
    return f"git config --file {files[0]}" if writes else None


def forbidden_hooks_env(segment: list[str]) -> str | None:
    """The environment spellings that set core.hooksPath without naming it on the command line.

    Two of them: `GIT_CONFIG_KEY_n=core.hooksPath` (with GIT_CONFIG_COUNT/VALUE_n), which git
    reads as an inline config entry; and `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM`, which point
    git at a config FILE this gate cannot read and that may set the key itself.

    Scoped to assignments that could actually take effect — a segment that runs git, or an
    `export` that sets them for a later one — and tokens holding whitespace are skipped as data,
    the same rule segment_text() uses, so `echo "GIT_CONFIG_KEY_0=core.hooksPath is the hole"`
    stays prose rather than becoming an offence.
    """
    if not segment:
        return None
    exported = os.path.basename(segment[0]) in EXPORT_BUILTINS
    if not exported:
        index = executable_index(segment)
        name = os.path.basename(segment[index]) if index is not None else None
        if name != "git":
            return None

    for token in segment:
        if QUOTED_DATA.search(token) or not ASSIGNMENT.match(token):
            continue
        key = GIT_CONFIG_KEY_ENV.match(token)
        if key and HOOKS_PATH_KEY.match(key.group(1).strip()):
            return token.split("=", 1)[0]
        redirect = GIT_CONFIG_FILE_ENV.match(token)
        if redirect and redirect.group(2) not in CONFIG_FILE_SINKS:
            return token.split("=", 1)[0]
    return None


def forbidden_git_alias(segment: list[str]) -> str | None:
    """`git config alias.<x> "commit --amend"` — a forbidden command, stored for later.

    DECISION: blocked at creation. Once the alias exists, `git z` carries no evidence of what
    it runs, so no later check — here or in a hook — can see it; creation is the only visible
    moment. The reason this can read a QUOTED operand when segment_text() deliberately drops
    quoted words as data is that the gate is `git config` + a key under `alias.`: for that one
    subcommand the quoted operand IS a command line, so there is no `echo "git commit --amend"`
    class of prose to confuse it with. Reads (`git config --get alias.ca`, `--get-regexp`) have
    no value operand and stay open.
    """
    args = git_subcommand_arguments(segment, "config")
    if args is None:
        return None
    positionals = [token for token in args if not token.startswith("-")]
    for offset, token in enumerate(positionals[:-1]):
        if ALIAS_KEY.match(token) and FORBIDDEN_ALIAS_BODY.search(positionals[offset + 1]):
            return f"git config {token}"
    return None


def forbidden_remote_operation(segment: list[str]) -> str | None:
    hooks = forbidden_hooks_path(segment)
    if hooks:
        return hooks
    hooks = forbidden_hooks_path_config(segment)
    if hooks:
        return hooks
    hooks = forbidden_hooks_env(segment)
    if hooks:
        return hooks
    hooks = forbidden_git_config_file(segment)
    if hooks:
        return hooks
    target = forbidden_config_file_write(segment)
    if target:
        return f"writing {target}"
    target = forbidden_hooks_file_write(segment)
    if target:
        return f"writing or removing the git hook {target}"
    push = git_subcommand_arguments(segment, "push")
    if push is not None:
        argument = forbidden_push_argument(push)
        if argument:
            return f"git push {argument}"
    remote = forbidden_git_remote(segment)
    if remote:
        return remote
    alias = forbidden_git_alias(segment)
    if alias:
        return alias
    return forbidden_gh_operation(segment)


# ── Shell quoting state ───────────────────────────────────────────────────────────────────
#
# Two rules below need the same question answered — "is this character QUOTED?" — and no
# regex can answer it. The model is the shell's:
#   * inside single quotes NOTHING is special, not even a backslash;
#   * inside double quotes a backslash escapes only `$`, a backtick, `"`, `\` and a newline;
#   * `$( … )` and backticks open a FRESH parsing context in which the enclosing quotes no
#     longer apply — which is why `git commit -m "$(cat <<'EOF' … )"`, this repo's dominant
#     commit form, really does contain a heredoc despite the `<<` sitting inside double
#     quotes. A scanner without that rule would stop stripping the one body that matters.
#
# State is a stack of FRAMES, each `[kind, quote, paren_depth]`. `paren_depth` counts bare
# `( … )` groups so a subshell inside a substitution cannot pop the substitution early.
DOUBLE_QUOTE_ESCAPES = '$`"\\\n'
# A backslash immediately before a newline. Named so the quoting rule that governs it stays
# readable — and pinnable — rather than hiding inside a wall of backslashes.
LINE_CONTINUATION = "\\\n"

# ANSI-C quoting. `$'…'` looks like a single-quoted string with a `$` in front and is not one:
# inside it a BACKSLASH IS AN ESCAPE. Modelling it as `$` + plain single quote — which is what
# this scanner did — desynchronises the quote state on the very first `\'`, and from there every
# later decision is inverted. MEASURED against bash 3.2.57:
#   set -- $'a\' #x'   -> [a' #x]      one word; the quote does NOT close at the `\'`
#   set -- $'it\'s' x  -> [it's][x]
# and the desync is a fail-OPEN in two separate rules that share this state machine:
#   echo $'a\' #x' ; git push --force origin main         — a phantom comment ate the push
#   echo $'a\' << b'<nl>git push --force origin main<nl>b — a phantom heredoc ate the push
# Both exited 0 and both are pinned below.
ANSI_C_QUOTE = "$'"
# `$"…"` is locale translation, and it is DOUBLE-quote semantics, not ANSI-C. Measured:
#   printf '[%s]' $"a #b"    -> [a #b]     the `#` is quoted, as in "…"
#   printf '[%s]' $"a \" #b" -> [a " #b]   a backslash escapes `"`
#   printf '[%s]' $"a\ #b"   -> [a\ #b]    …but NOT a space — exactly the `"…"` escape set
#   printf '[%s]' $"a\<nl>b" -> [ab]       and a backslash-newline IS a continuation
# So it opens the existing `"` state and needs no state of its own; only the two-character
# opener has to be consumed. DECISION: modelled rather than ignored, because leaving it out
# leaves the same class of desync open one character away from the one being fixed.
LOCALE_QUOTE = '$"'
# The quote states in which a backslash is an ORDINARY CHARACTER, so a backslash-newline inside
# them is two literal characters rather than a line continuation. Measured with od -c:
#   $'a\<nl>b'  -> a \ \n b   literal (ANSI-C leaves an unrecognised escape alone)
#   'a\<nl>b'   -> a \ \n b   literal
#   "a\<nl>b"   -> a b        joined
#   $"a\<nl>b"  -> a b        joined
LITERAL_BACKSLASH_QUOTES = ("'", ANSI_C_QUOTE)


def new_shell_state() -> list[list]:
    return [["top", None, 0]]


def consume_shell_char(text: str, index: int, frames: list[list]) -> int:
    """Advance ONE lexical unit at `index`, updating `frames` in place; return the next index."""
    ch = text[index]
    quote = frames[-1][1]

    if quote == "'":
        if ch == "'":
            frames[-1][1] = None
        return index + 1

    # ANSI-C quoting. Identical to the single-quote arm above EXCEPT that a backslash escapes,
    # which is the whole difference and the whole bug: without this arm the `'` in `$'a\'…'`
    # closes the string a character early and every later decision on the line is inverted.
    if quote == ANSI_C_QUOTE:
        if ch == "\\":
            return index + 2 if index + 1 < len(text) else index + 1
        if ch == "'":
            frames[-1][1] = None
        return index + 1

    if ch == "\\":
        following = text[index + 1] if index + 1 < len(text) else ""
        if quote == '"' and following not in DOUBLE_QUOTE_ESCAPES:
            return index + 1  # a literal backslash: inside double quotes it escapes little
        return index + 2 if following else index + 1

    # `$'` and `$"` are two-character openers, and BOTH are inert inside quotes — measured:
    # `"$'a\' #x'"` is the literal text `$'a\' #x'`, so the scan must not open a state there or
    # it desynchronises in the other direction.
    if ch == "$" and quote is None and text.startswith(ANSI_C_QUOTE, index):
        frames[-1][1] = ANSI_C_QUOTE
        return index + 2
    if ch == "$" and quote is None and text.startswith(LOCALE_QUOTE, index):
        frames[-1][1] = '"'
        return index + 2

    if ch == "'" and quote is None:
        frames[-1][1] = "'"
        return index + 1
    if ch == '"':
        frames[-1][1] = None if quote == '"' else '"'
        return index + 1
    if ch == "$" and text.startswith("$(", index) and quote in (None, '"'):
        frames.append(["sub", None, 0])
        return index + 2
    if ch == "`" and quote in (None, '"'):
        if frames[-1][0] == "tick":
            frames.pop()
        else:
            frames.append(["tick", None, 0])
        return index + 1
    if ch == "(" and quote is None:
        frames[-1][2] += 1
        return index + 1
    if ch == ")" and quote is None:
        if frames[-1][2] > 0:
            frames[-1][2] -= 1
        elif frames[-1][0] == "sub":
            frames.pop()
        return index + 1
    return index + 1


# bash resolves these inside `$'…'`; anything else keeps its backslash, which is why the
# default branch below re-emits `\` + the character rather than dropping the backslash.
ANSI_C_ESCAPES = {
    "a": "\a", "b": "\b", "e": "\x1b", "E": "\x1b", "f": "\f", "n": "\n",
    "r": "\r", "t": "\t", "v": "\v", "\\": "\\", "'": "'", '"': '"', "?": "?",
}


def posix_single_quote(text: str) -> str:
    """`text` as one shell word shlex can parse — the standard '"'"' break-out for quotes."""
    return "'" + text.replace("'", "'\"'\"'") + "'"


def normalise_ansi_c_quotes(command: str) -> str:
    """Rewrite `$'…'` spans as ordinary single-quoted words.

    shlex has no model of ANSI-C quoting, so `echo $'a\\' #x' ; git push --force origin main`
    raised ValueError("No closing quotation") — shlex read the ESCAPED `'` as the closer and
    then never found another. The command therefore never reached segmentation at all; it fell
    to unparseable_fallback(), which knows only `git … commit … --amend|--no-verify`, and the
    force push exited 0. Measured against real bash, which runs that push.

    consume_shell_char() already models `$'…'` correctly — this exists only so the SEGMENTER
    sees what the state machine already sees. The content is decoded and re-emitted verbatim
    (not blanked), so a subject keeps its true length and a command-running subcommand keeps a
    readable operand; only the SPELLING changes, from a form shlex cannot read to one it can.

    Fails safe by construction: an unterminated `$'` re-emits the original text untouched, so
    the command still reaches unparseable_fallback() rather than being silently rewritten into
    something parseable that means something else.
    """
    if ANSI_C_QUOTE not in command:
        return command
    frames = new_shell_state()
    out: list[str] = []
    index = 0
    while index < len(command):
        if frames[-1][1] is None and command.startswith(ANSI_C_QUOTE, index):
            body: list[str] = []
            scan = index + 2
            closed = False
            while scan < len(command):
                ch = command[scan]
                if ch == "\\" and scan + 1 < len(command):
                    following = command[scan + 1]
                    body.append(ANSI_C_ESCAPES.get(following, "\\" + following))
                    scan += 2
                    continue
                if ch == "'":
                    closed = True
                    scan += 1
                    break
                body.append(ch)
                scan += 1
            if not closed:
                return command
            out.append(posix_single_quote("".join(body)))
            index = scan
            continue
        following = consume_shell_char(command, index, frames)
        out.append(command[index:following])
        index = following
    return "".join(out)


# bash starts a comment at an unquoted `#` that BEGINS a word. These are the single characters
# that END a word, so an unquoted, UNESCAPED one of them leaves the scanner at a word start.
# Every case below was measured against bash 3.2.57 with an argv-printing probe:
#   set -- a#b            -> [a#b]          `#` mid-word is literal
#   set -- a #b …         -> the rest of the line vanished; only `a` survived
#   set -- "a #b"         -> [a #b]         quoted `#` is literal
#   set -- 'a#b'          -> [a#b]
#   set -- -m "fix #42"   -> [-m][fix #42]  the repo's commonest `#` — a message, not a comment
#   echo a;#b; echo c     -> a              `#` after an operator IS a comment
#   echo a >#b            -> syntax error   the comment ate the redirect target, so `>` too
#   set -- a$#b           -> [a0b]          `$#` is a parameter expansion, not a comment
#
# WHICH character is examined is the P0 this set was rewritten for. Reading the RAW previous
# character calls any delimiter in that position a word end, and a delimiter is only a delimiter
# when the shell reads it as one. Measured, all one word — no comment starts in any of them:
#   set -- a\ #b          -> [a #b]         the space is ESCAPED, so it is part of the word
#   set -- "a "#b         -> [a #b]         and so is a space inside quotes
#   set -- "a"#b          -> [a#b]          a closing quote does not end the word either
#   set -- $(echo z)#b    -> [z#b]          nor does a substitution's closing paren
# `echo a\ #b; git push --force origin main` was exit 0 and PROVEN to rewrite published history
# in a throwaway pair: the phantom comment deleted the push from view. So the decision is made
# from the previous LEXICAL UNIT — see word_start_after().
COMMENT_WORD_START = " \t\r;&|()<>"


def word_start_after(consumed: str, frames: list[list], depth_before: int) -> bool:
    """Does a WORD begin right after the lexical unit `consumed`?

    `consumed` is exactly what consume_shell_char() advanced over, and `depth_before` is the
    frame-stack height before it ran — which is how an OPENING `$(` / backtick is told from the
    CLOSING one, since both are one lexical unit and only the opener starts a fresh word:

        $(echo z)#b   -> [z#b]   measured: after the closing paren the word CONTINUES
        $(#b<nl>…)    -> the `#` right after the opener IS a comment

    Everything else is a word start only when it is a single, unquoted, UNESCAPED delimiter. An
    escaped delimiter arrives here as a TWO-character unit (`\\ `) and a quoted one arrives with
    a non-None quote on the frame, so both fall through to False — which is the entire fix.
    """
    if frames[-1][1] is not None:
        return False  # still inside a quoted string: nothing in one begins a word
    if len(frames) > depth_before:
        return True  # `$(` or a backtick opened a fresh parsing context
    if len(frames) < depth_before:
        return False  # …and closing one does not end the word
    return len(consumed) == 1 and consumed in COMMENT_WORD_START


def strip_comment(line: str, frames: list[list], word_start: bool) -> tuple[str, bool]:
    """`line` truncated at an unquoted comment, plus "does it end in a line continuation".

    Closes a P0 that needed no adversarial intent at all: `git push --force origin main # don't`
    is an ordinary explanatory comment, and its apostrophe made shlex raise "No closing
    quotation" — so the whole command fell through to unparseable_fallback(), which knows only
    `git … commit … --amend`, and the force push exited 0. Modelling the comment makes the
    command PARSE, and then the existing push rules block it. Widening the textual fallback to
    know push vocabulary was the alternative and was rejected: it would start blocking
    `rg 'git push --force'` and every doc that mentions the command.

    It also removes a heredoc opener that was never one. `echo hi # a << b` contains no
    operator — the `<<` is inside a comment — and heredoc_openers() read it as one, deleting
    every line up to the next line spelling `b`. A comment stripped before that scan cannot
    open a phantom body.

    `frames` is only READ (a copy is scanned), because the caller advances the real state over
    the TRUNCATED line — the text bash actually tokenizes.

    `word_start` says whether index 0 begins a word. It does NOT when the previous physical
    line ended in a line continuation, and getting that wrong is a fail-OPEN: bash joins
    `echo a\\` + `#; git push --force origin main` into `echo a#; git push --force origin main`
    and RUNS the push (measured), so treating the `#` as a comment there would delete a real
    invocation from view.
    """
    scan = [list(frame) for frame in frames]
    index = 0
    dangling = False
    at_word_start = word_start
    while index < len(line):
        if line[index] == "#" and scan[-1][1] is None and at_word_start:
            # A comment cannot end in a continuation: bash does NOT join a backslash at the end
            # of a comment to the next line. Measured — `echo LINE1 #foo\<nl>echo BOOM` printed
            # both LINE1 and BOOM, so the next line is a fresh command, not comment text.
            return line[:index], False
        dangling = (
            line[index] == "\\"
            and scan[-1][1] not in LITERAL_BACKSLASH_QUOTES
            and index + 1 == len(line)
        )
        depth = len(scan)
        following = consume_shell_char(line, index, scan)
        at_word_start = word_start_after(line[index:following], scan, depth)
        index = following
    return line, dangling


def escaped_line_break(command: str, index: int) -> int:
    """Characters a line continuation occupies at `index`, or 0 if there is none.

    Two spellings, and the second was a live P0. `\\` + newline is the ordinary one. A `\\` at
    the very END of the input is a continuation to nothing: bash drops it and runs the command
    unchanged — measured, `printf "[%s]" --force origin main \\` printed
    `[--force][origin][main]`. shlex instead raises ValueError("No escaped character"), so
    `git push --force origin main \\` fell through to unparseable_fallback() and exited 0.

    A DOUBLED backslash is not this: `printf "[%s]" a\\\\` printed `a\\`, an escaped literal.
    Nothing special-cases it here because consume_shell_char() consumes both characters as one
    unit, so index never lands on the second one.
    """
    if not command.startswith("\\", index):
        return 0
    if command.startswith(LINE_CONTINUATION, index):
        return 2
    if index + 1 == len(command):
        return 1
    return 0


def strip_line_continuations(command: str) -> str:
    """Apply the shell's line-continuation rule: a backslash before a newline VANISHES.

    Without this the lexer read the newline as a command separator regardless, so

        git push \\
        --force origin main

    segmented into `git push` (an allowed plain push) and `--force origin main` (an orphan
    with no executable, waved through). Measured at exit 0, and PROVEN DESTRUCTIVE in a
    sandbox pair: it rewrote published history. The newline cannot simply be dropped from
    the lexer's punctuation set either — that is what makes a newline-joined script segment
    at all, and removing it re-opens `echo x\\ngit commit --amend`.

    Quoting decides, and the three positions differ:
      * UNQUOTED — a continuation, both characters removed;
      * inside DOUBLE quotes — still a continuation (the shell removes it there too);
      * inside SINGLE quotes — LITERAL, both characters kept, because nothing is special
        inside single quotes — and the same inside `$'…'`, where a backslash IS an escape but
        `\\<newline>` is not one of the escapes ANSI-C recognises, so bash leaves both
        characters in place (measured with od -c: `$'a\\<nl>b'` -> `a \\ \\n b`).
    Joining a line that should not have been joined is the fail-open direction, so the
    single-quote case is the one that must not be got wrong.

    A backslash at END OF INPUT is the same rule with the newline missing — see
    escaped_line_break(), which is where both spellings are decided.
    """
    frames = new_shell_state()
    kept: list[str] = []
    index = 0
    while index < len(command):
        span = (
            0
            if frames[-1][1] in LITERAL_BACKSLASH_QUOTES
            else escaped_line_break(command, index)
        )
        if span:
            index += span
            continue
        following = consume_shell_char(command, index, frames)
        kept.append(command[index:following])
        index = following
    return "".join(kept)


def heredoc_delimiter(line: str, index: int) -> tuple[str | None, int]:
    """The delimiter WORD after a `<<`/`<<-` operator, and the index just past it.

    Returns (None, …) when the word cannot be read — an unterminated quote, a trailing
    backslash, or no word at all. The caller must then strip NOTHING: an undelimitable body
    is exactly the case this function's caller used to guess at.

    Quoting a delimiter (`<<'EOF'`, `<<"EOF"`, `<<\\EOF`) only suppresses expansion INSIDE
    the body; it does not change where the body ends, so all three yield the same word.
    """
    while index < len(line) and line[index] in " \t":
        index += 1
    parts: list[str] = []
    while index < len(line):
        ch = line[index]
        if ch in " \t;&|<>()":
            break
        if ch in "'\"":
            close = line.find(ch, index + 1)
            if close < 0:
                return None, index
            parts.append(line[index + 1 : close])
            index = close + 1
            continue
        if ch == "\\":
            if index + 1 >= len(line):
                return None, index
            parts.append(line[index + 1])
            index += 2
            continue
        parts.append(ch)
        index += 1
    delimiter = "".join(parts)
    return (delimiter or None), index


def heredoc_openers(line: str, frames: list[list]) -> tuple[list[tuple[str, bool]], bool]:
    """Every UNQUOTED heredoc operator on `line`, as (delimiter, tab_stripped), plus an
    "abandon this line" flag. `frames` carries quoting state ACROSS lines and is mutated.

    The old regex matched `<<` anywhere, including inside a quoted string, and that is the
    whole defect: `echo "a << b"` was read as a heredoc for delimiter `b`, so every line up
    to the next line spelling `b` was DELETED — including a real `git push --force origin
    main`, measured at exit 0. A `<<<` here-string is not a heredoc either; it has no body.
    """
    found: list[tuple[str, bool]] = []
    index = 0
    while index < len(line):
        if frames[-1][1] is None and line.startswith("<<", index):
            if line.startswith("<<<", index):
                index += 3  # here-string: the word is on this line, there is no body
                continue
            cursor = index + 2
            dash = cursor < len(line) and line[cursor] == "-"
            if dash:
                cursor += 1
            delimiter, cursor = heredoc_delimiter(line, cursor)
            if delimiter is None:
                # Structure unreadable. Deleting lines is the fail-OPEN direction here, so
                # this line contributes no openers at all and everything below is scanned.
                return [], True
            found.append((delimiter, dash))
            index = cursor
            continue
        index = consume_shell_char(line, index, frames)
    return found, False


def heredoc_terminator(line: str, delimiter: str, dash: bool) -> bool:
    """The shell's own terminator rule: the line must BE the delimiter.

    `<<-` strips leading TABS from the terminator as well as from the body, and nothing else
    is tolerated. The previous `.strip()` was looser than the shell, which is the deleting
    direction — a line the shell would treat as body could end a strip early here.
    """
    return (line.lstrip("\t") if dash else line) == delimiter


def strip_heredoc_bodies(command: str) -> str:
    """Remove heredoc BODIES and shell COMMENTS, keeping the command skeleton.

    The two are done in ONE walk because that is the only order that is right for both, and
    each of the two obvious orders is wrong for the other:
      * comments must be stripped BEFORE heredoc openers are looked for, or `echo hi # a << b`
        opens a phantom heredoc for delimiter `b` and every line up to the next `b` is deleted;
      * heredoc BODIES must never be comment-stripped, because a body is literal DATA — a `#`
        in it is a hash, not a comment — and scanning body prose would also desynchronise the
        quote state that decides the next real command line.
    Interleaving gives bash's own behaviour: comments are recognised while tokenizing a command
    line, and a body is read raw from the line after the opener. Body lines never reach
    strip_comment() because the terminator search skips over them.

    `shlex` has no heredoc model, so an unquoted body is lexed as ordinary command text —
    a single apostrophe in English prose ("doesn't") opens a quote that never closes and
    tokenizing raises ValueError. Bodies are never policy-relevant: only the command line
    around them is. Stripping them lets a `cat > notes.md <<'EOF' … EOF` call tokenize.

    Every uncertainty resolves toward KEEPING text, because deleting is what turns this
    function into a bypass. A body is dropped only when its operator was found unquoted, its
    delimiter word parsed cleanly, and its terminator was actually located; miss any one and
    the lines stay in place and get scanned.
    """
    lines = command.split("\n")
    kept: list[str] = []
    frames = new_shell_state()
    index = 0
    word_start = True
    while index < len(lines):
        line, continued = strip_comment(lines[index], frames, word_start)
        word_start = not continued
        kept.append(line)
        index += 1
        openers, abandoned = heredoc_openers(line, frames)
        if abandoned:
            continue
        for delimiter, dash in openers:
            end = index
            while end < len(lines) and not heredoc_terminator(lines[end], delimiter, dash):
                end += 1
            if end >= len(lines):
                # No terminator: this is not a body we can delimit, so keep every line rather
                # than swallow the remainder of the command line.
                break
            kept.append(lines[end])  # keep the terminator so structure survives
            index = end + 1
            # A body always ends at its own terminator line, so whatever came after the opener
            # cannot be continuing a word into the next command line.
            word_start = True
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


def nested_git_commands(segment: list[str]) -> list[tuple[str, object]]:
    """Commands a `git` segment will itself RUN, as (kind, value) pairs.

    `git submodule foreach`, `git bisect run`, `git rebase --exec` and `git filter-branch
    --*-filter` all take another command and execute it. That makes them wrappers in exactly
    the sense `bash -c` is — and they were wide open, because check_command()'s textual
    fallback is gated on `name != "git"` (the executable here IS git) and the subcommand is not
    `commit`, so neither the structured check nor the textual one looked. Measured at exit 0:
    `git submodule foreach git commit --amend` and `git bisect run git commit --no-verify`.

    Two shapes, because the operand can arrive either way:
      * "segment" — an argv slice starting at a bare `git` word (`… run git commit --amend`);
      * "text"    — a whole command in ONE quoted token (`… foreach 'git commit --amend'`),
                    which is re-lexed the way a `bash -c` payload is.

    Scoped to those four subcommands ON PURPOSE. This is the only place a quoted operand is
    read as a command, and widening it to every git subcommand would resurrect the prose false
    positives: `git config alias.x "commit --amend"` and `git log -- git-commit--amend.md` must
    not be read as invocations here (the first has its own targeted rule, see
    forbidden_git_alias()).
    """
    index = executable_index(segment)
    if index is None or os.path.basename(segment[index]) != "git":
        return []
    index += 1
    while index < len(segment):
        token = segment[index]
        if not token.startswith("-"):
            break
        if token in GIT_OPTIONS_WITH_VALUE:
            index += 2
            continue
        index += 1
    if index >= len(segment) or segment[index] not in GIT_COMMAND_RUNNING_SUBCOMMANDS:
        return []

    found: list[tuple[str, object]] = []
    for offset in range(index + 1, len(segment)):
        token = segment[offset]
        if QUOTED_DATA.search(token):
            found.append(("text", token))
        elif os.path.basename(token) == "git":
            # Everything from the nested `git` onward is one argv line; re-checking the slice
            # covers `git push --force` inside a foreach as well as `git commit --amend`.
            found.append(("segment", segment[offset:]))
            break
    return found


def check_command(command: str, depth: int = 0, raw: str | None = None) -> int:
    """`raw` is the ORIGINAL text a heredoc body is read out of, and it stays the OUTERMOST
    command line as this recurses into `bash -c` / `eval` payloads — once the skeleton has
    been stripped, that is the only place the body still exists verbatim.
    """
    if depth > MAX_SHELL_NESTING:
        # NOT `return 0`. Exceeding the recursion bound means "this script could not analyse
        # the command", and that must never be spelled "allow" — it is the one answer an
        # attacker can always reach, by adding one more `bash -c`. Fails CLOSED instead.
        return nesting_limit_reached()
    if not command:
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
    #
    # ORDER: heredocs-and-comments FIRST, continuations second — the reverse of round 3's, and
    # the reverse is required now that comments are modelled. A comment is a PHYSICAL-line
    # construct and a backslash at the end of one does NOT continue it (measured: `echo LINE1
    # #foo\<nl>echo BOOM` printed both). Joining first destroys the line boundary the comment
    # ends at, so `echo x #foo\<nl>git push --force origin main` would collapse into a single
    # commented-out line and the push would vanish from view — a fail-open.
    try:
        segments = command_segments(strip_line_continuations(strip_heredoc_bodies(command)))
    except ValueError as error:
        return unparseable_fallback(command, error)

    for segment in segments:
        status = check_segment(segment, raw, depth)
        if status:
            return status
    return 0


def check_segment(segment: list[str], raw: str, depth: int) -> int:
    """Policy for ONE command segment. Extracted from check_command()'s loop so that a git
    segment which runs a nested command (`git submodule foreach git commit --amend`) can send
    the nested argv slice back through the identical checks instead of a weaker textual scan.
    """
    try:
        payload = shell_payload(segment)
        if payload is None:
            payload = eval_payload(segment)
        if payload is not None:
            if depth >= MAX_SHELL_NESTING:
                # Out of unwrapping budget. Degrading to unresolvable_segment()'s textual scan
                # was STILL a bypass, twice over: that scan knows only the two `git commit`
                # flags, so a nested `git push --force` is invisible to it, and segment_text()
                # drops the payload token because it holds whitespace — so it scanned the
                # literal text `bash -c` and found nothing. Measured: four levels of `bash -c`
                # turned BOTH `git push --force origin main` and `git commit --amend` into
                # exit 0, while levels 0-3 blocked. Fail CLOSED.
                return nesting_limit_reached()
            # `raw` — NOT the payload — carries down as the heredoc source. The payload
            # token was cut from the STRIPPED skeleton, so a heredoc body inside it is
            # already gone; passing it as its own raw text left `bash -c 'git commit -m
            # "$(cat <<EOF … EOF)"'` with no subject to measure, and a 74-char subject
            # went from blocked to exit 0. The outer raw text still holds that body.
            return check_command(payload, depth + 1, raw)

        remote = forbidden_remote_operation(segment)
        if remote:
            print(
                f"Blocked by .agents/rules/cycle-orchestration.md §Never, even when "
                f"authorized: {remote} is forbidden.\n"
                "Plain `git push` is allowed. Forbidden are the pushes that rewrite or "
                "remove published refs — --force/--force-with-lease/-f, a leading `+` on "
                "a refspec, --mirror, --prune, and deletions (--delete/-d or an empty-source "
                "`:branch`); the pushes that switch their own enforcement off (--no-verify, "
                "-c core.hooksPath=…); re-pointing a remote; WRITING a git config file "
                "(.git/config, ~/.gitconfig, $XDG_CONFIG_HOME/git/config) by redirection, "
                "tee, sed -i, cp/mv or `git config --file`, since that is how core.hooksPath "
                "is set without naming it; WRITING, DELETING, TRUNCATING, CHMOD-ing or "
                "SYMLINKING a file inside a `.git/hooks/` directory, since a hook that does "
                "not run is the same outcome as core.hooksPath=/dev/null; and the "
                "outward-facing GitHub operations — opening or merging a PR, deleting a repo "
                "or release, and a destructive `gh api` call.\n"
                "READING those files is fine — `cat`, `grep`, `ls`, `git config --get`, "
                "`git config --list`.\n"
                "To install or repair the hooks, run .agents/scripts/install-git-hooks.sh — "
                "that is the sanctioned path, and it stays open.\n"
                "Ask the user to run it.",
                file=sys.stderr,
            )
            return 2

        # A git segment that RUNS another command is a wrapper, and the nested command gets
        # the same treatment as a `bash -c` payload. This must sit before the commit lookup:
        # the outer segment's own subcommand (`submodule`, `bisect`) is not `commit`, so
        # without it the invocation below is never inspected by anything.
        for kind, value in nested_git_commands(segment):
            if kind == "text":
                if depth >= MAX_SHELL_NESTING:
                    return nesting_limit_reached()
                status = check_command(str(value), depth + 1, raw)
            else:
                status = check_segment(list(value), raw, depth)
            if status:
                return status

        args = commit_arguments(segment)
        if args is None:
            # THE fail-open branch. `args is None` conflates two unrelated outcomes:
            #   * the executable IS `git` and the subcommand simply is not `commit`
            #     (`git log`, `git status`) — fully resolved, nothing to check; and
            #   * the executable is something this resolver does not model at all, which
            #     may still EXEC a `git commit --amend` one token later.
            # Both used to `continue` in silence, so every wrapper outside EXEC_WRAPPERS
            # was a total bypass — `caffeinate git commit --amend` exited 0 with EMPTY
            # stderr, and so did 17 other measured wrappers. Enumerating wrapper names
            # against an open set cannot win, so the second case now degrades to the same
            # textual scan its two sibling branches already use.
            #
            # The `name != "git"` guard is what made `git submodule foreach git commit
            # --amend` invisible; nested_git_commands() above closes that case STRUCTURALLY
            # rather than by deleting the guard, because deleting it would convict every
            # `git log -- docs/git-commit--amend-notes.md` style path argument instead.
            executable = executable_index(segment)
            name = os.path.basename(segment[executable]) if executable is not None else None
            if name != "git" and GIT_WORD.search(segment_text(segment)):
                return unresolvable_segment(
                    segment,
                    f"unrecognised executable {name!r}" if name else "no executable found",
                )
            return 0
    except UnresolvedWrapper as error:
        return unresolvable_segment(segment, str(error))

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
