#!/bin/bash
# Behavioural tests for the pre-push hook that .agents/scripts/install-git-hooks.sh generates.
#
# WHY THIS FILE EXISTS
# The push gate shipped with zero tests. `grep -c pre-push .agents/scripts/test-agent-config.mjs`
# returned 0, which means the entire hook body could be replaced with `exit 0` and the whole
# agent-config suite still passed. A gate nothing tests is a gate that decays into a comment.
#
# WHAT IT TESTS
# The hook is not stubbed or re-implemented here. Every case runs install-git-hooks.sh into a
# throwaway root, takes the pre-push it generates, and drives it through REAL git pushes between
# throwaway local repo pairs — so the generation path, the argv contract, and the stdin contract
# are all under test. Cases that cannot be produced by a normal `git push` (an unverifiable
# remote tip, a line with no trailing newline, a short line) are fed to the hook on stdin
# directly, exactly as git would.
#
# The pushes are real writes to bare repos created under $TMPDIR seconds earlier and deleted on
# exit. Nothing here touches a configured remote, and the throwaway repos have no network remote
# to reach even if it did.
#
# RUN
#   bash .agents/scripts/test-git-hooks.sh          # quiet unless something fails
#   VERBOSE=1 bash .agents/scripts/test-git-hooks.sh
#
# MUTATION CHECK — the only proof that a test suite is load-bearing. Replace the hook body the
# installer emits with `exit 0` and this suite must go red; restore it and it must go green.
set -uo pipefail

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
installer="$here/install-git-hooks.sh"
[ -f "$installer" ] || { echo "test-git-hooks: cannot find $installer" >&2; exit 2; }

work=$(mktemp -d "${TMPDIR:-/tmp}/git-hooks-test.XXXXXX") || exit 2
trap 'rm -rf "$work"' EXIT

# Bare TMPDIR-scoped repos must not inherit the developer's ~/.gitconfig: a global
# core.hooksPath, a push.default, or a commit.gpgsign would silently change what is being
# measured. Identity is set per repo below for the same reason.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid
export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid

# Clear every variable that binds git to ANOTHER repository before touching the throwaway
# ones. This is not hygiene, it is required: this suite is wired into the pre-commit hook, and
# `git commit` exports GIT_INDEX_FILE (among others) to its hooks. Inherited, it points every
# `git add` below at the outer repo's index — measured, the force-push case then reported
# "push SUCCEEDED", a false GREEN on the single most important assertion here, purely because
# the seed commit never happened. `--local-env-vars` is git's own list of exactly these.
for v in $(git rev-parse --local-env-vars 2>/dev/null); do unset "$v"; done
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX 2>/dev/null || true

pass=0
fail=0
failures=()

note() { [ -n "${VERBOSE:-}" ] && printf '    %s\n' "$*"; return 0; }

ok()   { pass=$((pass + 1)); [ -n "${VERBOSE:-}" ] && printf '  ok   %s\n' "$1"; return 0; }
bad()  { fail=$((fail + 1)); failures+=("$1"); printf '  FAIL %s\n' "$1" >&2; return 0; }

# ------------------------------------------------------------------
# Generate the hook exactly the way a developer gets it.
#
# The installer walks $root/projects/* for nested repos; this fake root has none, so it
# installs into the fake root repo only and reports the skip. What lands in
# fakeroot/.git/hooks/pre-push is byte-for-byte what every real repo would receive.
# ------------------------------------------------------------------
fakeroot="$work/fakeroot"
mkdir -p "$fakeroot/.agents/scripts"
cp "$installer" "$fakeroot/.agents/scripts/install-git-hooks.sh"
git init -q "$fakeroot" || exit 2
if ! bash "$fakeroot/.agents/scripts/install-git-hooks.sh" >"$work/install.log" 2>&1; then
  echo "test-git-hooks: install-git-hooks.sh failed:" >&2
  cat "$work/install.log" >&2
  exit 2
fi
HOOK="$fakeroot/.git/hooks/pre-push"
if [ ! -x "$HOOK" ]; then
  echo "test-git-hooks: the installer did not produce an executable pre-push at $HOOK" >&2
  cat "$work/install.log" >&2
  exit 2
fi
if ! bash -n "$HOOK" 2>"$work/syntax.log"; then
  echo "test-git-hooks: generated pre-push is not valid bash:" >&2
  cat "$work/syntax.log" >&2
  exit 2
fi

# ------------------------------------------------------------------
# pair <name> — a bare upstream + a working clone with the hook installed.
#
# Seeds: main (2 commits) and a branch `doomed` on the remote, so deletion and prune cases
# have something real to destroy. Echoes the clone's path.
#
# mktemp, not a counter: pair() is always called as `r=$(pair)`, which runs it in a subshell,
# so an incrementing variable would reset to 0 every call and every case would collide on one
# directory — silently reusing a half-built repo from the previous test. (It did. The suite
# reported four impossible failures on the allow cases until this was fixed.)
# ------------------------------------------------------------------
pair() {
  local d
  d=$(mktemp -d "$work/pair.XXXXXX") || return 1
  git init -q --bare "$d/up.git"
  git init -q "$d/seed"
  (
    cd "$d/seed" || exit 1
    git symbolic-ref HEAD refs/heads/main
    git remote add origin "$d/up.git"
    echo a > f && git add f && git commit -qm c1
    echo b > f && git commit -qam c2
    git push -q origin main
    git checkout -qb doomed
    echo d > g && git add g && git commit -qm doomed
    git push -q origin doomed
    git checkout -q main
  ) >/dev/null 2>&1 || { echo "seed failed" >&2; return 1; }
  git clone -q "$d/up.git" "$d/w" >/dev/null 2>&1
  cp "$HOOK" "$d/w/.git/hooks/pre-push"
  chmod +x "$d/w/.git/hooks/pre-push"
  printf '%s\n' "$d/w"
}

upstream_of() { printf '%s\n' "${1%/w}/up.git"; }

# run_push <label> <expect: block|allow> <repo> <git push args…>
run_push() {
  local label=$1 expect=$2 repo=$3
  shift 3
  local out rc
  out=$(cd "$repo" && git push "$@" 2>&1)
  rc=$?
  note "rc=$rc :: git push $*"
  note "$out"
  if [ "$expect" = block ]; then
    if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q 'pre-push: BLOCKED'; then
      ok "$label"
    elif [ "$rc" -ne 0 ]; then
      bad "$label — push failed (rc=$rc) but NOT via the hook; it may have been rejected for another reason: $(printf '%s' "$out" | head -1)"
    else
      bad "$label — push SUCCEEDED (rc=0); the hook let a destructive push through"
    fi
  else
    if [ "$rc" -eq 0 ]; then
      ok "$label"
    else
      bad "$label — legitimate push was REFUSED (rc=$rc): $(printf '%s' "$out" | head -3 | tr '\n' ' ')"
    fi
  fi
}

# feed <label> <expect> <repo> <stdin-payload>
# Drives the hook the way git does — argv "<remote> <url>", ref lines on stdin — for the
# shapes no ordinary `git push` will produce.
feed() {
  local label=$1 expect=$2 repo=$3 payload=$4
  local out rc
  out=$( (cd "$repo" && printf '%s' "$payload" | ./.git/hooks/pre-push origin "$(upstream_of "$repo")" ) 2>&1 )
  rc=$?
  note "rc=$rc :: stdin=[$payload]"
  note "$out"
  if [ "$expect" = block ]; then
    if [ "$rc" -ne 0 ]; then ok "$label"; else bad "$label — hook returned rc=0 on stdin it cannot judge"; fi
  else
    if [ "$rc" -eq 0 ]; then ok "$label"; else bad "$label — hook returned rc=$rc on a legitimate ref line"; fi
  fi
}

echo "test-git-hooks: pre-push gate"

# ==================================================================
# MUST BLOCK
# ==================================================================

# 1. Force push after a reset — the canonical history rewrite.
r=$(pair) || exit 2
( cd "$r" && git reset -q --hard HEAD~1 && echo x > f && git commit -qam rewrite ) >/dev/null 2>&1
run_push "block: force push after reset" block "$r" --force origin main

# 2. A leading + on the refspec — same rewrite, no --force anywhere on the command line.
r=$(pair) || exit 2
( cd "$r" && git reset -q --hard HEAD~1 && echo x > f && git commit -qam rewrite ) >/dev/null 2>&1
run_push "block: +refspec force" block "$r" origin +main:main

# 3. Empty-source refspec — the oldest spelling of "delete the remote branch".
r=$(pair) || exit 2
run_push "block: :branch deletion" block "$r" origin :doomed

# 4. --delete, the modern spelling of the same thing.
r=$(pair) || exit 2
run_push "block: --delete" block "$r" --delete origin doomed

# 5. --mirror from a normal clone. Its prune half never appears on stdin; the tell is that it
#    ships refs/remotes/* to refs/remotes/* on the remote.
r=$(pair) || exit 2
run_push "block: --mirror" block "$r" --mirror origin

# 6. Plain `git push origin` from a `git clone --mirror`. remote.origin.mirror=true makes this
#    a mirror push, and the prune half deletes remote-only refs with ZERO stdin lines — so the
#    hook must refuse on the configuration, before it ever reads stdin.
r=$(pair) || exit 2
mup=$(upstream_of "$r")
git clone -q --mirror "$mup" "$work/mirrorclone.git" >/dev/null 2>&1
cp "$HOOK" "$work/mirrorclone.git/hooks/pre-push"
chmod +x "$work/mirrorclone.git/hooks/pre-push"
git --git-dir="$work/mirrorclone.git" update-ref -d refs/heads/doomed
mout=$(cd "$work/mirrorclone.git" && git push origin 2>&1); mrc=$?
note "rc=$mrc :: $mout"
if [ "$mrc" -ne 0 ] && printf '%s' "$mout" | grep -q 'pre-push: BLOCKED'; then
  ok "block: plain push from a --mirror clone"
elif git --git-dir="$mup" show-ref --quiet refs/heads/doomed; then
  bad "block: plain push from a --mirror clone — push returned rc=$mrc without the hook blocking"
else
  bad "block: plain push from a --mirror clone — refs/heads/doomed was PRUNED off the upstream"
fi

# 5b. `--m`, which git accepts as an unambiguous abbreviation of --mirror and honours in full.
#     The command gate reads strings and let this through; the hook never sees the flag at all,
#     only the refs/remotes lines it produces, so the spelling is irrelevant here. That is the
#     entire argument for putting the check at this layer, so it gets an assertion.
r=$(pair) || exit 2
run_push "block: --m (abbreviated --mirror)" block "$r" --m origin

# 5c. `git push --prune origin 'refs/heads/*:refs/heads/*'` — prune a remote branch with no
#     --delete, no --force and no colon-refspec anywhere on the command line. Unlike the
#     --mirror prune, THIS one is reported: git emits a real "(delete)" line for it, so the
#     deletion rule catches it. Asserted because the command gate does not.
r=$(pair) || exit 2
( cd "$r" && git branch -qD doomed 2>/dev/null; git branch -q -r -d origin/doomed 2>/dev/null ) >/dev/null 2>&1
run_push "block: --prune with a wildcard refspec" block "$r" --prune origin 'refs/heads/*:refs/heads/*'

# 7. Fail closed on a remote tip this repo does not have. Ancestry is unjudgeable, and
#    "I cannot tell" must never resolve to "allowed". git produces this after someone else
#    rewrites the branch; here it is fed directly because it depends on remote state.
r=$(pair) || exit 2
head=$(cd "$r" && git rev-parse HEAD)
absent=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
feed "block: remote_sha absent locally (fail closed)" block "$r" \
  "refs/heads/main $head refs/heads/main $absent
"

# 7b. The SAME line with no trailing newline. `read` returns non-zero on an unterminated final
#     line, so the plain `while read …` form discarded it — not even the malformed-line branch
#     fired, and the push was allowed. Measured rc=0 before the `|| [ -n "$local_ref" ]` fix.
feed "block: unterminated final line, absent remote_sha" block "$r" \
  "refs/heads/main $head refs/heads/main $absent"

# 7c. Unterminated deletion line — same defect, and this one silently allows a branch delete.
feed "block: unterminated final line, deletion" block "$r" \
  "(delete) 0000000000000000000000000000000000000000 refs/heads/main $head"

# 7d. A short line means the stdin contract changed or something else is driving the hook.
#     Refuse rather than guess — including when it is unterminated.
feed "block: malformed short line" block "$r" "refs/heads/main $head
"
feed "block: malformed short line, unterminated" block "$r" "refs/heads/main $head"

# 7e. A legitimate line FOLLOWED by a bad unterminated one: the good line must not mask it.
feed "block: bad unterminated line after a good line" block "$r" \
  "refs/heads/main $head refs/heads/main $(cd "$r" && git rev-parse HEAD)
refs/heads/other $head refs/heads/other $absent"

# ==================================================================
# MUST ALLOW — the deploy path. zulfahmi.dev ships on a plain push to main; a false positive
# here is an outage, so these are as load-bearing as the blocks.
# ==================================================================

# 8. Ordinary fast-forward.
r=$(pair) || exit 2
( cd "$r" && echo more > f && git commit -qam ff ) >/dev/null 2>&1
run_push "allow: fast-forward push" allow "$r" origin main

# 8b. …and the upstream really did move (a hook that blocked would also leave it unmoved).
if [ "$(git --git-dir="$(upstream_of "$r")" rev-parse refs/heads/main)" = "$(cd "$r" && git rev-parse HEAD)" ]; then
  ok "allow: fast-forward actually landed on the upstream"
else
  bad "allow: fast-forward reported success but the upstream ref did not move"
fi

# 9. First push of a NEW branch. remote_sha is all zeros — a creation, not a deletion. The
#    zero-SHA test has to be read on the LOCAL side only or every new branch is refused.
r=$(pair) || exit 2
( cd "$r" && git checkout -qb feature && echo n > h && git add h && git commit -qm feat ) >/dev/null 2>&1
run_push "allow: first push of a new branch" allow "$r" origin feature

# 10. A new tag, pushed by name.
r=$(pair) || exit 2
( cd "$r" && git tag v1 ) >/dev/null 2>&1
run_push "allow: new tag" allow "$r" origin v1

# 11. --tags.
r=$(pair) || exit 2
( cd "$r" && git tag v1 && git tag v2 ) >/dev/null 2>&1
run_push "allow: --tags" allow "$r" --tags origin

# 12. --follow-tags — how the portfolio deploy push is actually spelled.
r=$(pair) || exit 2
( cd "$r" && echo z > f && git commit -qam ff && git tag -a v1 -m v1 ) >/dev/null 2>&1
run_push "allow: --follow-tags" allow "$r" --follow-tags origin main

# 13. --all with no rewrite: every local branch, all fast-forward.
r=$(pair) || exit 2
( cd "$r" && echo z > f && git commit -qam ff && git checkout -qb extra && echo e > i && git add i && git commit -qm extra ) >/dev/null 2>&1
run_push "allow: --all with no rewrite" allow "$r" --all origin

# 14. The backup idiom: snapshot a remote-tracking ref onto a new branch before doing something
#     risky. local_ref is under refs/remotes/*, which the first revision of this hook refused
#     outright as a mirror proxy — but the destination is refs/heads/*, and it is a creation.
r=$(pair) || exit 2
run_push "allow: refs/remotes/origin/main -> refs/heads/backup (backup idiom)" allow "$r" \
  origin refs/remotes/origin/main:refs/heads/backup

# 14b. …and the guard it must NOT have lost: refs/remotes -> refs/remotes is still a mirror.
r=$(pair) || exit 2
rhead=$(cd "$r" && git rev-parse refs/remotes/origin/main)
feed "block: refs/remotes -> refs/remotes (mirror shape)" block "$r" \
  "refs/remotes/origin/main $rhead refs/remotes/origin/main 0000000000000000000000000000000000000000
"

# ==================================================================
echo
if [ "$fail" -ne 0 ]; then
  printf 'test-git-hooks: %d passed, %d FAILED\n' "$pass" "$fail" >&2
  for f in "${failures[@]}"; do printf '  - %s\n' "$f" >&2; done
  exit 1
fi
printf 'test-git-hooks: %d passed\n' "$pass"
