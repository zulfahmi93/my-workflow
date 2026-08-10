#!/bin/bash
# Behavioural tests for the PreToolUse(Edit|Write|NotebookEdit) git-internals write policy.
#
# WHY THIS HARNESS AND NOT test-agent-config.mjs
# test-agent-config.mjs asserts things about the CONFIGURATION (roles, tools, wiring) by
# reading files. This gate's contract is a PROCESS contract — a JSON payload on stdin, an
# exit code out, a message on stderr — and it depends on the real filesystem: symlinks, `..`
# traversal, a nested repo's `.git/`, a HOME-relative global config. That is exactly the
# contract test-git-hooks.sh already tests for the pre-push hook, in exactly this style, so
# this file is its sibling: real payloads, into the REAL .claude/hooks wrapper, which execs
# the REAL policy. Nothing is stubbed or re-implemented, so the wrapper's payload plumbing,
# the exit-code protocol and the path resolution are all under test together.
#
# RUN
#   bash .agents/scripts/test-git-internals-hook.sh             # quiet unless something fails
#   VERBOSE=1 bash .agents/scripts/test-git-internals-hook.sh
#
# MUTATION CHECK — the only proof a suite is load-bearing:
#   bash .agents/scripts/test-git-internals-hook.sh --mutation
# copies the hook + policy into a throwaway root, replaces the policy body with `exit 0`,
# re-runs this suite against the copy and requires it to go RED. The real files are never
# touched.
set -uo pipefail

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$here/../.." && pwd)

# HOOK_ROOT is the tree whose hook is under test. Defaults to the real repo; the mutation
# mode points it at a mutated copy.
HOOK_ROOT=${HOOK_ROOT:-$repo_root}
HOOK="$HOOK_ROOT/.claude/hooks/block-git-internals-writes.sh"
POLICY="$HOOK_ROOT/.agents/scripts/check-git-internals-path.py"

# ------------------------------------------------------------------
# --mutation: prove the suite is load-bearing.
# ------------------------------------------------------------------
if [ "${1:-}" = "--mutation" ]; then
  m=$(mktemp -d "${TMPDIR:-/tmp}/git-internals-mutation.XXXXXX") || exit 2
  trap 'rm -rf "$m"' EXIT
  mkdir -p "$m/.claude/hooks" "$m/.agents/scripts"
  cp "$HOOK" "$m/.claude/hooks/" || exit 2
  cp "$repo_root/.agents/scripts/test-git-internals-hook.sh" "$m/.agents/scripts/" || exit 2
  printf '#!/usr/bin/env python3\nimport sys\nsys.exit(0)  # MUTANT: policy disabled\n' \
    > "$m/.agents/scripts/check-git-internals-path.py"
  chmod +x "$m/.agents/scripts/check-git-internals-path.py"
  echo "mutation: policy replaced with exit 0 in $m — the suite must now FAIL"
  if HOOK_ROOT="$m" bash "$m/.agents/scripts/test-git-internals-hook.sh"; then
    echo "MUTATION CHECK FAILED: the suite passed against a policy that allows everything." >&2
    exit 1
  fi
  echo "mutation check ok: the suite goes red when the policy is disabled."
  exit 0
fi

[ -x "$HOOK" ] || { echo "test-git-internals: $HOOK is missing or not executable" >&2; exit 2; }
[ -f "$POLICY" ] || { echo "test-git-internals: $POLICY is missing" >&2; exit 2; }
bash -n "$HOOK" || { echo "test-git-internals: the hook wrapper is not valid bash" >&2; exit 2; }

work=$(mktemp -d "${TMPDIR:-/tmp}/git-internals-test.XXXXXX") || exit 2
trap 'rm -rf "$work"' EXIT

pass=0
fail=0
failures=()
ok()  { pass=$((pass + 1)); [ -n "${VERBOSE:-}" ] && printf '  ok   %s\n' "$1"; return 0; }
bad() { fail=$((fail + 1)); failures+=("$1"); printf '  FAIL %s\n' "$1" >&2; return 0; }

# ------------------------------------------------------------------
# Fixtures. Real directories, a real nested repo, a real symlink — the whole point is that
# the policy resolves paths rather than pattern-matching strings.
# ------------------------------------------------------------------
FIX="$work/fixture"
FAKE_HOME="$work/home"
FAKE_XDG="$work/xdg"
mkdir -p \
  "$FIX/.git/hooks" \
  "$FIX/docs" \
  "$FIX/src" \
  "$FIX/projects/rintis/kobu-bot/.git/hooks" \
  "$FIX/projects/x/.github/workflows" \
  "$FAKE_HOME" \
  "$FAKE_XDG/git"
ln -s "$FIX/.git" "$FIX/gitlink"           # symlinked .git directory
ln -s "$FIX/docs" "$FIX/docslink"          # innocent symlink, used by an allow case
: > "$FIX/docs/git-notes.md"
: > "$FIX/docs/git-commit--amend-notes.md"
: > "$FIX/src/app.ts"
: > "$FIX/mything.gitconfig"
: > "$FAKE_HOME/mything.gitconfig"

# ------------------------------------------------------------------
# check <name> <allow|block> <cwd> <tool_name> <tool_input JSON>
#
# Builds the payload with python3 so no path can be broken by shell quoting, then feeds it
# to the real wrapper on stdin exactly as the harness would.
# ------------------------------------------------------------------
check() {
  local name=$1 expect=$2 cwd=$3 tool=$4 ti=$5 payload out rc
  payload=$(python3 -c 'import json,sys; print(json.dumps({"session_id":"t","cwd":sys.argv[3],"tool_name":sys.argv[1],"tool_input":json.loads(sys.argv[2])}))' "$tool" "$ti" "$cwd") \
    || { bad "$name (could not build payload)"; return 0; }
  out=$(cd "$cwd" && printf '%s' "$payload" | env HOME="$FAKE_HOME" XDG_CONFIG_HOME="$FAKE_XDG" \
        CLAUDE_PROJECT_DIR="$HOOK_ROOT" bash "$HOOK" 2>&1)
  rc=$?
  case "$expect:$rc" in
    allow:0) ok "$name" ;;
    block:2) ok "$name" ;;
    allow:*) bad "$name — expected exit 0 (allow), got $rc: $out" ;;
    block:*) bad "$name — expected exit 2 (block), got $rc: $out" ;;
  esac
  # A deny must SAY something, or the agent sees a bare failure and retries blind.
  if [ "$expect" = block ] && [ "$rc" = 2 ] && [ -z "$out" ]; then
    bad "$name — blocked with an empty message"
  fi
  return 0
}

# check_raw <name> <allow|block> <raw stdin>  — malformed-payload cases.
check_raw() {
  local name=$1 expect=$2 raw=$3 out rc
  out=$(printf '%s' "$raw" | env HOME="$FAKE_HOME" XDG_CONFIG_HOME="$FAKE_XDG" \
        CLAUDE_PROJECT_DIR="$HOOK_ROOT" bash "$HOOK" 2>&1)
  rc=$?
  case "$expect:$rc" in
    allow:0|block:2) ok "$name" ;;
    *) bad "$name — expected $expect, got exit $rc: $out" ;;
  esac
  return 0
}

# JSON-encode one file_path / notebook_path object.
ti_file() { python3 -c 'import json,sys; print(json.dumps({"file_path": sys.argv[1], "content": "x"}))' "$1"; }
ti_edit() { python3 -c 'import json,sys; print(json.dumps({"file_path": sys.argv[1], "old_string": "a", "new_string": "b"}))' "$1"; }
ti_nb()   { python3 -c 'import json,sys; print(json.dumps({"notebook_path": sys.argv[1], "new_source": "x"}))' "$1"; }

echo "test-git-internals: hook under test = $HOOK"

# ==================================================================
# BLOCKED
# ==================================================================

# 1. The keystone: the monorepo's own .git/config, absolute.
check "block: root .git/config (the real repo)" block "$repo_root" Write "$(ti_file "$repo_root/.git/config")"

# 1b. …and in the fixture repo, via Edit rather than Write.
check "block: .git/config via Edit" block "$FIX" Edit "$(ti_edit "$FIX/.git/config")"

# 2. A NESTED repo's config — kobu-bot has its own remote, so its hook matters just as much.
check "block: nested repo projects/rintis/kobu-bot/.git/config" block "$FIX" Write \
  "$(ti_file "$FIX/projects/rintis/kobu-bot/.git/config")"

# 3. The installed hook itself — same attack, one step more direct.
check "block: .git/hooks/pre-push" block "$FIX" Write "$(ti_file "$FIX/.git/hooks/pre-push")"
check "block: nested .git/hooks/pre-push" block "$FIX" Write \
  "$(ti_file "$FIX/projects/rintis/kobu-bot/.git/hooks/pre-push")"

# 4. `..` traversal, absolute and relative. A substring test would catch these by accident;
#    the point is that the resolved path is what decides.
check "block: absolute ../ traversal (docs/../.git/config)" block "$FIX" Write \
  "$(ti_file "$FIX/docs/../.git/config")"
check "block: relative ../ traversal from cwd" block "$FIX/docs" Write "$(ti_file "../.git/config")"
check "block: plain relative .git/config from cwd" block "$FIX" Write "$(ti_file ".git/config")"

# 5. Symlinked .git directory — resolution, not spelling.
check "block: symlink gitlink/config -> .git/config" block "$FIX" Write "$(ti_file "$FIX/gitlink/config")"

# 6. Global config: a global core.hooksPath disarms every repo at once.
check "block: literal ~/.gitconfig" block "$FIX" Write "$(ti_file "~/.gitconfig")"
check "block: \$HOME/.gitconfig absolute" block "$FIX" Write "$(ti_file "$FAKE_HOME/.gitconfig")"
check "block: \$XDG_CONFIG_HOME/git/config" block "$FIX" Write "$(ti_file "$FAKE_XDG/git/config")"

# 7. NotebookEdit's field name. block-generated-html.sh shipped inert on this arm once by
#    reading file_path only; this asserts the same bug cannot recur here.
check "block: NotebookEdit notebook_path into .git/" block "$FIX" NotebookEdit \
  "$(ti_nb "$FIX/.git/hooks/pre-push")"

# 8. Case variant — macOS filesystems are case-insensitive, so .GIT/ is the same directory.
check "block: .GIT/config (case variant)" block "$FIX" Write "$(ti_file "$FIX/.GIT/config")"

# 9. Deeper git state: submodule/worktree gitdirs live under .git/modules and .git/worktrees.
check "block: .git/modules/<sub>/config" block "$FIX" Write "$(ti_file "$FIX/.git/modules/sub/config")"

# 10. Malformed / missing payloads FAIL CLOSED. An unreadable payload is not evidence the
#     write is safe, and the blast radius here is a silently disarmed push gate.
check_raw "block: payload is not JSON" block "not json at all"
check_raw "block: payload is a JSON array, not an object" block '[1,2,3]'
check_raw "block: payload has no tool_input" block '{"tool_name":"Write"}'
check_raw "block: tool_input carries no path field" block '{"tool_name":"Write","tool_input":{"content":"x"}}'
check_raw "block: empty stdin" block ""

# ==================================================================
# ALLOWED — every one of these is ordinary work. A gate that misfires here is a gate
# agents learn to route around, which is worse than no gate.
# ==================================================================

check "allow: projects/x/.github/workflows/ci.yml" allow "$FIX" Write \
  "$(ti_file "$FIX/projects/x/.github/workflows/ci.yml")"
check "allow: a file named mything.gitconfig" allow "$FIX" Write "$(ti_file "$FIX/mything.gitconfig")"
check "allow: x.gitconfig in HOME (not ~/.gitconfig)" allow "$FIX" Write \
  "$(ti_file "$FAKE_HOME/mything.gitconfig")"
check "allow: docs/git-notes.md" allow "$FIX" Edit "$(ti_edit "$FIX/docs/git-notes.md")"
check "allow: docs/git-commit--amend-notes.md" allow "$FIX" Edit \
  "$(ti_edit "$FIX/docs/git-commit--amend-notes.md")"
check "allow: ordinary source file" allow "$FIX" Edit "$(ti_edit "$FIX/src/app.ts")"
check "allow: relative ordinary path from cwd" allow "$FIX/src" Write "$(ti_file "app.ts")"
check "allow: .gitignore" allow "$FIX" Write "$(ti_file "$FIX/.gitignore")"
check "allow: .github dir itself" allow "$FIX" Write "$(ti_file "$FIX/projects/x/.github/CODEOWNERS")"
check "allow: innocent symlinked dir (docslink/notes.md)" allow "$FIX" Write \
  "$(ti_file "$FIX/docslink/notes.md")"
check "allow: NotebookEdit on an ordinary notebook" allow "$FIX" NotebookEdit \
  "$(ti_nb "$FIX/docs/analysis.ipynb")"
check "allow: a path merely containing the string .git" allow "$FIX" Write \
  "$(ti_file "$FIX/docs/mygitconfig-and-.gitfoo.md")"

# ==================================================================
echo
if [ "$fail" -ne 0 ]; then
  printf 'test-git-internals: %d passed, %d FAILED\n' "$pass" "$fail" >&2
  for f in "${failures[@]}"; do printf '  - %s\n' "$f" >&2; done
  exit 1
fi
printf 'test-git-internals: %d passed\n' "$pass"
