#!/usr/bin/env python3
"""Block Edit/Write/NotebookEdit writes whose target lands inside git's own state.

WHY THIS EXISTS
`.git/` is git's private state. Normal work never hand-edits it — you change it by running
git, and every git command already passes through the Bash command gate. One file in there
is load-bearing for this repo's whole destructive-push defence:

    printf '[core]\\nhooksPath = /dev/null\\n' >> .git/config

sets `core.hooksPath` without running a single git command, so no command-string rule can
see it, and it switches the installed pre-push hook OFF for that repo. Everything the push
gate promises rests on that hook actually running. The sibling policy covers the Bash
spelling of that write. This one covers the OTHER surface with the same effect and no shell
involved at all: an agent calling Edit, Write or NotebookEdit on `.git/config` directly.
Nothing watched that path before this file.

`.git/hooks/*` is blocked for the same reason one step more directly — overwriting the
installed pre-push hook with `exit 0` disarms it without touching any config key. And
`~/.gitconfig` / `$XDG_CONFIG_HOME/git/config` are blocked because a *global*
core.hooksPath disables the hook in every repository at once, including the nine with live
GitHub remotes.

WHAT IS AND IS NOT A MATCH
The test is a resolved *path component* equal to `.git`, never a substring. Substring
matching would block `projects/x/.github/workflows/ci.yml` and a file named
`mything.gitconfig`, which are ordinary files — and a gate that misfires on ordinary work is
one an agent learns to route around. Paths are resolved first, so `docs/../.git/config`,
a relative path, and a symlinked directory all land on the same answer as the plain
spelling. Both the lexical (`..`-collapsed) and the symlink-resolved forms are tested and
either one matching blocks: they disagree only when a symlink sits above a `..`, and the
safe reading of a disagreement is the blocking one.

Nested repos count. `projects/rintis/kobu-bot/.git/config` disables the push hook of a repo
with its own remote, so the rule is "any `.git/` anywhere", not "the root one".

FAIL CLOSED
A payload this script cannot read is not evidence that the write is safe. Unlike the
generated-path adapters — which fall open, because their worst case is a file the next
build overwrites — an unreadable payload here exits 2. The blast radius on the other side
is a silently disarmed push gate on repos that deploy.

EXIT PROTOCOL (same as the other PreToolUse policies): 0 allow, 2 deny, message on stderr.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Importing nothing sibling here, but the other hooks set this and the reason applies to any
# script that runs on every Edit/Write: CPython would otherwise write __pycache__/ into
# .agents/scripts/, and a full build is supposed to produce zero git dirt.
sys.dont_write_bytecode = True

RULE = "git-internals-write policy"

# Every field name the Edit / Write / NotebookEdit family uses for its target. Edit and Write
# send `file_path`; NotebookEdit sends `notebook_path`. block-generated-html.sh had to learn
# this the hard way — it asked for `file_path` only, so its NotebookEdit arm matched, ran,
# and allowed everything. Extra spellings are cheap here and a missing one is a silent hole.
PATH_FIELDS = ("file_path", "notebook_path", "path", "filePath", "notebookPath")

REMEDY = (
    "For a legitimate git configuration change use `git config <key> <value>` "
    "(or `git config --global <key> <value>`), which the Bash command gate then evaluates "
    "on its merits. Never hand-edit git's own state."
)


def _resolved_forms(raw: str) -> list[Path]:
    """Every absolute path this string could denote, lexical and symlink-resolved.

    A relative path is anchored on BOTH the process cwd and the monorepo root. The hook runs
    with whatever cwd the session happens to have — often a nested project — and guessing
    wrong would let `.git/config` through under one of the two readings.
    """
    forms: list[Path] = []
    repo_root = Path(__file__).resolve().parents[2]

    # Both the literal spelling and the variable-expanded one. They differ only for a path
    # containing `$`, and testing both means neither reading can slip past.
    spellings = {os.path.expanduser(raw), os.path.expanduser(os.path.expandvars(raw))}

    bases: list[str] = []
    for expanded in spellings:
        if os.path.isabs(expanded):
            bases.append(expanded)
        else:
            bases.append(os.path.join(os.getcwd(), expanded))
            bases.append(os.path.join(str(repo_root), expanded))

    for base in bases:
        # normpath collapses `..` textually; realpath follows symlinks. They differ only when
        # a symlink sits above a `..` component, and both readings are checked so that a
        # disagreement blocks rather than slips through.
        forms.append(Path(os.path.normpath(base)))
        forms.append(Path(os.path.realpath(base)))
    return forms


def _global_config_paths() -> list[Path]:
    """The config files git reads outside any repository.

    A `core.hooksPath` set in any of these disables the pre-push hook in EVERY repo at once,
    which is strictly worse than the per-repo `.git/config` case.
    """
    home = Path(os.path.expanduser("~"))
    xdg = os.environ.get("XDG_CONFIG_HOME") or str(home / ".config")

    paths = [
        home / ".gitconfig",
        Path(xdg) / "git" / "config",
        Path("/etc/gitconfig"),
        Path("/usr/local/etc/gitconfig"),
        Path("/opt/homebrew/etc/gitconfig"),
    ]
    # git honours these overrides when set; if the session has them, they are the live files.
    for var in ("GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM"):
        value = os.environ.get(var)
        if value and value not in ("/dev/null",):
            paths.append(Path(value))

    resolved: list[Path] = []
    for path in paths:
        resolved.append(path)
        resolved.append(Path(os.path.realpath(str(path))))
    return resolved


def classify(raw: str) -> str | None:
    """Return a human reason to block this target, or None to allow it."""
    globals_ = _global_config_paths()
    xdg_git_dir = Path(os.environ.get("XDG_CONFIG_HOME") or str(Path(os.path.expanduser("~")) / ".config")) / "git"
    xdg_git_dirs = {xdg_git_dir, Path(os.path.realpath(str(xdg_git_dir)))}

    for form in _resolved_forms(raw):
        # `.git` as a path COMPONENT — never a substring. `.github`, `.gitignore` and
        # `x.gitconfig` are different components and stay allowed.
        for part in form.parts:
            if part.lower() == ".git":
                return f"{form} is inside git's own state (a `.git` directory)"

        if form in globals_:
            return f"{form} is a global git config file (a global core.hooksPath disables the push hook everywhere)"

        for git_dir in xdg_git_dirs:
            try:
                form.relative_to(git_dir)
            except ValueError:
                continue
            return f"{form} is inside git's XDG config directory {git_dir}"

    return None


def _collect_targets(tool_input: dict) -> list[str]:
    targets = []
    for field in PATH_FIELDS:
        value = tool_input.get(field)
        if isinstance(value, str) and value.strip():
            targets.append(value)
    # Defensive: any other *_path / *Path string field a future tool shape introduces. A
    # target this script does not look at is a target it cannot block.
    for key, value in tool_input.items():
        if key in PATH_FIELDS:
            continue
        if isinstance(value, str) and value.strip() and (key.endswith("_path") or key.endswith("Path")):
            targets.append(value)
    return targets


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        print(f"{RULE}: hook payload is not valid JSON ({error}); refusing the write.", file=sys.stderr)
        print(REMEDY, file=sys.stderr)
        return 2
    if not isinstance(payload, dict):
        print(f"{RULE}: hook payload is not a JSON object; refusing the write.", file=sys.stderr)
        print(REMEDY, file=sys.stderr)
        return 2

    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        print(f"{RULE}: hook payload has no tool_input object; refusing the write.", file=sys.stderr)
        print(REMEDY, file=sys.stderr)
        return 2

    targets = _collect_targets(tool_input)
    if not targets:
        tool = payload.get("tool_name")
        tool = tool if isinstance(tool, str) else "?"
        print(
            f"{RULE}: no target path in the {tool} payload "
            f"(looked for {', '.join(PATH_FIELDS)}); refusing the write rather than guessing it is safe.",
            file=sys.stderr,
        )
        print(REMEDY, file=sys.stderr)
        return 2

    for raw in targets:
        reason = classify(raw)
        if reason is not None:
            print(f"Blocked by the {RULE}: {reason}.", file=sys.stderr)
            print(
                "`.git/` is git's own state and is never hand-edited in normal work; "
                "`.git/config` in particular can switch off the pre-push hook the whole "
                "destructive-push defence rests on, and `.git/hooks/*` is that hook itself.",
                file=sys.stderr,
            )
            print(REMEDY, file=sys.stderr)
            return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
