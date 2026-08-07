#!/usr/bin/env python3
"""Block shell commands that WRITE INTO THE REPO when the caller is a read-only role.

The review family (read-only-roles.mjs §READ_ONLY_ROLES) is denied Edit/Write/NotebookEdit
by its `tools:` allowlist, and validate-agent-config.mjs enforces that. All three keep
**Bash**, and Bash is a complete write channel: measured, `printf "" > .agents/roles/
code-reviewer.md` sent as a Code Reviewer exited 0 through BOTH existing PreToolUse hooks,
as did `sed -i "" s/x/y/ src/pay.ts` sent as a Finding Verifier. The tool allowlist said
read-only and the terminal was not read-only, the same shape as the gap
check-generated-command.py exists to close for `docs/html/`.

Why it matters where the verifier is concerned: tdd-cycle.js asks the Finding Verifier to
refute a review finding. A verifier that can write could REPAIR the defect it was asked to
check ("the null guard is missing in src/pay.ts" → add the guard → grep it → `refuted:
true`), and the workflow files that into `hallucinationsRejected`, injects it into every
later review prompt as a hallucination guard, and skips the REFACTOR. Silent and
self-reinforcing.

Bash cannot simply be removed: the Code Reviewer's own standard is "quote the gate result
or run the stated test command yourself", so the role needs a shell. The boundary is
therefore not "no shell" but **no shell write into the repository working tree** — a
reviewer may still `npm test >/tmp/out.log 2>&1`, `2>/dev/null`, and read anything.

BUILDABILITY (measured 2026-08-07, Claude Code 2.1.223 — see read-only-roles.mjs
§AGENT_IDENTITY_EVIDENCE for the full record). A PreToolUse payload carries `agent_type`,
and for a subagent it holds the acting agent's own `name:`. Dumped from a real session, the
workflow dispatch path — which is the one that matters, since tdd-cycle.js dispatches with
`agentType: 'Code Reviewer'` — reported `agent_type: 'Echo Checker'` for an agent declared
as `name: Echo Checker`, NOT the built-in `workflow-subagent`. Main-thread calls omit the
field entirely, so the gate is inert outside a subagent, which is what keeps it from
policing the orchestrator.

Deliberately CONSERVATIVE about paths, in the same spirit as check-generated-command.py: a
write is blocked only when the target can be tied to a write position this script can
actually resolve AND that target lands inside the repo. Merely NAMING a repo path is fine.
Unresolvable shapes (shell expansion in the word, an untokenizable line) are skipped, since
a missed exotic write is a lint miss while a false block stops a real review.

Deliberately NOT conservative about the git subcommands below: `git checkout` / `restore` /
`stash` / `reset` mutate the working tree without naming the files they rewrite, so there is
no target to resolve and no honest way to allow them narrowly. A reviewer never needs them.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parents[1]

# Set BEFORE load_lexer() runs. Importing a sibling by path makes CPython write
# `.agents/scripts/__pycache__/`, and this hook fires on every Bash call — so the tree grew
# an untracked directory during any session with a reviewer in it, which is exactly the
# "a full build produces zero git dirt" property the repo works to keep. Nothing here is hot
# enough for the cached bytecode to matter.
sys.dont_write_bytecode = True


def load_lexer():
    """The shell grammar from check-generated-command.py, imported rather than re-written.

    That module already resolves exec wrappers (`nohup`, `env`, `xargs`, `timeout`, …), the
    spaceless-redirect lexing that #20 walked through, and `bash -c` / `eval` payloads. A
    third copy of that grammar would drift from the other two the first time one is fixed —
    the same argument read-only-roles.mjs makes for single-sourcing READ_ONLY_ROLES.

    Imported under its own module name, so the `if __name__ == "__main__"` guard there keeps
    its main() from running on import.
    """
    path = SCRIPTS_DIR / "check-generated-command.py"
    spec = importlib.util.spec_from_file_location("check_generated_command", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# Loaded once, at import, but never allowed to take the hook down with it: a missing or
# broken sibling would otherwise raise here, the wrapper would exit non-zero, and EVERY
# agent's every Bash call would be blocked by a gate that is supposed to constrain three
# roles. None means "fail open, loudly" — handled in main().
try:
    LEXER = load_lexer()
except Exception as error:  # noqa: BLE001 — any import failure must fail open, not raise
    LEXER = None
    LEXER_ERROR = str(error)


# `2>&1` duplicates a file descriptor; it writes no file. The operand is a bare number, and
# without this it resolves to `<cwd>/1` — which IS inside the repo, so every `cmd 2>&1` a
# reviewer runs would false-block. check-generated-command.py never hit this because `1` is
# not under docs/html/, so the same scan is safe there and is not safe here.
FD_DUP = re.compile(r"^[0-9]*>&$")
FD_OPERAND = re.compile(r"^-?[0-9]*$")

# Subcommands that rewrite the working tree or published history. `push` and `commit` are
# already the commit gate's business; they are repeated here because this gate answers a
# different question ("may THIS role write at all") and must not depend on another hook
# being wired to be correct.
GIT_WRITE_SUBCOMMANDS = {
    "am", "apply", "checkout", "cherry-pick", "clean", "commit", "merge", "mv", "push",
    "rebase", "reset", "restore", "revert", "rm", "stash", "switch",
}
# git's own options that consume a SEPARATE value, so the subcommand is not misread from
# `git -C projects/foo status`.
GIT_VALUE_OPTIONS = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"}

# Commands where every non-flag operand is a write target. `rm` and `ln` are added to
# check-generated-command.py's set: that module only cares about clobbering generated HTML,
# where a delete is a non-event, while here a reviewer deleting a source file is precisely
# the failure being prevented.
EXTRA_ALL_OPERANDS = {"rm", "ln"}

ROLE_LIST = re.compile(r"export\s+const\s+READ_ONLY_ROLES\s*=\s*\[(.*?)\]", re.S)
ROLE_ENTRY = re.compile(r"['\"]([^'\"]+)['\"]")
# `[ \t]` not `\s`: `\s` matches a newline, so a role file whose `name:` value is empty
# captured the NEXT line ("description: >") as the role's display name. That name normalizes
# to something no `agent_type` can ever equal, so the identity set silently lost a read-only
# role and the gate failed OPEN for it — the one direction this gate must never fail. The
# same one-character slip was fixed in validate-agent-config.mjs's role parser.
ROLE_NAME = re.compile(r"^name:[ \t]*(.+)$", re.M)


def normalize(value: str) -> str:
    """Fold a role identifier to one comparison space.

    `agent_type` arrives as the role's DISPLAY name ("Code Reviewer") while
    READ_ONLY_ROLES is written in FILENAME space ("code-reviewer.md"). Those are the two
    spaces validate-agent-config.mjs already notes nothing maps between. Normalizing both
    ends is that map, and it is also what the harness itself does when resolving a
    requested agent type to a definition.
    """
    return re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")


def read_only_identities() -> set[str] | None:
    """Normalized identities of every read-only role, or None if the policy is unreadable.

    Derived from read-only-roles.mjs so this gate cannot disagree with the validator about
    who is read-only — adding a fourth review role must not require remembering this file.

    BOTH the role's `name:` and its filename stem are included. The filename alone would be
    a silent single point of failure: a role whose `name:` diverged from its filename would
    stop matching `agent_type` and the gate would quietly stop firing, which is the failure
    mode this whole ticket is about.
    """
    source = (SCRIPTS_DIR / "read-only-roles.mjs").read_text(encoding="utf-8")
    block = ROLE_LIST.search(source)
    if not block:
        return None
    identities: set[str] = set()
    for filename in ROLE_ENTRY.findall(block.group(1)):
        stem = filename[:-3] if filename.endswith(".md") else filename
        identities.add(normalize(stem))
        try:
            role = (REPO_ROOT / ".agents/roles" / filename).read_text(encoding="utf-8")
        except OSError:
            continue
        name = ROLE_NAME.search(role)
        if name:
            identities.add(normalize(name.group(1)))
    return identities or None


def is_repo_write(word: str, cwd: str) -> bool:
    """True when `word` resolves to a path inside the repo working tree.

    Relative to the CALLER's cwd, not the repo root — the shell resolves a redirect target
    against cwd, and agents routinely work from inside `projects/<group>/<name>/`. (This is
    the one place that deliberately differs from check-generated-command.py, which resolves
    against the repo root because it is matching a path SHAPE, `docs/html/`, rather than
    asking whether a write lands in the tree.)

    `/dev/null`, `/tmp/...` and anything else outside the tree answer False, which is what
    keeps `npm test >/tmp/out.log 2>&1` working.
    """
    if not word or LEXER.EXPANSION.search(word):
        return False
    if FD_OPERAND.fullmatch(word):
        return False
    candidate = word if os.path.isabs(word) else os.path.join(cwd, word)
    normalized = os.path.normpath(candidate)
    root = str(REPO_ROOT)
    return normalized == root or normalized.startswith(root + os.sep)


def git_subcommand(words: list[str]) -> str | None:
    """The subcommand of a `git` invocation, resolving past git's own global options."""
    index = 1
    while index < len(words):
        token = words[index]
        if token in GIT_VALUE_OPTIONS:
            index += 2
            continue
        if token.startswith("-"):
            index += 1
            continue
        return token
    return None


def offending(segment: list[str], cwd: str) -> str | None:
    """The first resolvable repo-write in this segment, or None."""
    for index, word in enumerate(segment):
        if LEXER.REDIRECT.fullmatch(word) and index + 1 < len(segment):
            target = segment[index + 1]
            # `2>&1` / `2>&-`: descriptor duplication, not a file write.
            if FD_DUP.fullmatch(word) and FD_OPERAND.fullmatch(target):
                continue
            if is_repo_write(target, cwd):
                return target
        if word.startswith("of=") and is_repo_write(word[3:], cwd):
            return word[3:]

    words = LEXER.strip_redirects(segment)
    start = LEXER.command_index(words)
    if start is None:
        return None
    name = os.path.basename(words[start])
    operands = [w for w in words[start + 1:] if not w.startswith("-")]

    if name == "git":
        subcommand = git_subcommand(words[start:])
        if subcommand in GIT_WRITE_SUBCOMMANDS:
            return f"git {subcommand}"
        return None
    if name in (LEXER.ALL_OPERANDS | EXTRA_ALL_OPERANDS):
        for word in operands:
            if is_repo_write(word, cwd):
                return word
    if name == "sed" and any(w == "-i" or w.startswith("-i") for w in words[start + 1:]):
        # Blocked outright, not per-operand. `-i` IS an in-place edit by definition, and
        # deciding WHICH operand it rewrites means reimplementing sed's argument grammar:
        # GNU attaches the backup suffix (`-i.bak`) while BSD takes it as a separate operand
        # (`sed -i '' s/x/y/ f`), so the script sits at a different index per platform.
        # Inheriting check-generated-command.py's `operands[1:]` here got the right answer
        # for the wrong reason — on BSD form it resolved the SCRIPT `s/x/y/` as a path,
        # which happens to sit under the repo root and so happened to block. That would
        # equally have blocked `sed -i 's/a/b/' /tmp/scratch` while naming a nonexistent
        # file. A read-only role has no legitimate `sed -i`, so say that instead.
        return "sed -i"
    if name in LEXER.DEST_LAST and operands:
        if is_repo_write(operands[-1], cwd):
            return operands[-1]
    return None


def report(hit: str, role: str) -> int:
    print(
        f"Blocked by .agents/roles/{role}: a read-only role may not write into the repo "
        f"({hit}).\n"
        "REVIEW is a review — a reviewer that patches the diff becomes its co-author and "
        "the independent gate collapses. Report the finding instead; REFACTOR applies it.\n"
        "Reads are unaffected, and scratch output outside the tree (e.g. >/tmp/out.log, "
        "2>/dev/null) is still allowed.",
        file=sys.stderr,
    )
    return 2


def check_command(command: str, cwd: str, role: str, depth: int = 0) -> int:
    try:
        parsed = LEXER.segments(command)
    except ValueError as error:
        # Same posture as both sibling gates: unresolvable means skip, loudly.
        print(f"read-only policy: skipping unparseable command ({error})", file=sys.stderr)
        return 0

    for segment in parsed:
        hit = offending(segment, cwd)
        if hit:
            return report(hit, role)
        words = LEXER.strip_redirects(segment)

        # `cd` moves the target of every later relative write in the line. Without this,
        # `cd /tmp && echo x > scratch.txt` resolved `scratch.txt` against the PAYLOAD cwd
        # (the repo) and false-blocked a write that actually lands in /tmp — the exact
        # "false block stops real work" failure the sibling gates warn about.
        # An unresolvable target (shell expansion) deliberately leaves cwd alone rather than
        # clearing it: staying put resolves later relative writes against the repo and so
        # fails CLOSED, which is the safe direction for a gate that guards a review verdict.
        # Approximate for `cd` inside a pipeline, which really runs in a subshell — that
        # over-approximates the move, and only ever toward blocking.
        start = LEXER.command_index(words)
        if start is not None and os.path.basename(words[start]) == "cd":
            targets = [w for w in words[start + 1:] if not w.startswith("-")]
            if len(targets) == 1 and not LEXER.EXPANSION.search(targets[0]):
                cwd = os.path.normpath(
                    targets[0] if os.path.isabs(targets[0]) else os.path.join(cwd, targets[0])
                )

        for payload in (LEXER.shell_payload(words), LEXER.eval_payload(words)):
            if not payload:
                continue
            if depth >= LEXER.MAX_SHELL_NESTING:
                # Falls CLOSED, unlike check-generated-command.py's cap and like the commit
                # gate's. That module guards against a hand-edit the next `npm run build`
                # would silently overwrite; this one guards the integrity of a review
                # verdict, where returning 0 makes a deep enough nest a free bypass.
                print(
                    "read-only policy: shell nesting limit reached; a read-only role may "
                    "not run shell payloads this deeply nested.",
                    file=sys.stderr,
                )
                return 2
            if check_command(payload, cwd, role, depth + 1) == 2:
                return 2
    return 0


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        print(f"read-only policy: payload is not valid JSON ({error}); NOT applied", file=sys.stderr)
        return 0
    if not isinstance(payload, dict):
        print("read-only policy: payload is not a JSON object; NOT applied", file=sys.stderr)
        return 0

    # Absent on the main thread even in `--agent` sessions (harness contract, verified by
    # dump), so this gate is inert for the orchestrator and fires only inside a subagent.
    agent_type = payload.get("agent_type")
    if not isinstance(agent_type, str) or not agent_type.strip():
        return 0

    if LEXER is None:
        print(
            f"read-only policy: could not load the shell grammar from "
            f"check-generated-command.py ({LEXER_ERROR}); policy NOT applied",
            file=sys.stderr,
        )
        return 0

    try:
        identities = read_only_identities()
    except OSError as error:
        print(f"read-only policy: cannot read read-only-roles.mjs ({error}); NOT applied", file=sys.stderr)
        return 0
    if identities is None:
        # Fails OPEN, loudly. A broken derivation is a repo-integrity problem, not a
        # property of the command in hand, and blocking every agent's every Bash call is a
        # worse failure than not running. validate-agent-config.mjs drives this hook with
        # real allow/block cases, so the breakage reds the gate there rather than here.
        print(
            "read-only policy: could not derive READ_ONLY_ROLES from read-only-roles.mjs; "
            "policy NOT applied",
            file=sys.stderr,
        )
        return 0
    if normalize(agent_type) not in identities:
        return 0

    tool_input = payload.get("tool_input")
    command = tool_input.get("command") if isinstance(tool_input, dict) else None
    if not isinstance(command, str) or not command.strip():
        return 0

    cwd = payload.get("cwd")
    if not isinstance(cwd, str) or not cwd:
        cwd = os.getcwd()

    return check_command(command, os.path.normpath(cwd), normalize(agent_type) + ".md")


if __name__ == "__main__":
    raise SystemExit(main())
