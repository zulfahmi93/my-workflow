# Monorepo infra backlog

Small, cross-cutting fixes to the shared agent machinery — `tools/docs-gen/`, `.agents/`, `.claude/`. These affect **every project in the repo**, not one nested project, which is why they cannot live in a project plan.

Surfaced 2026-07-19 by the u60-monitor open-issue sweep (`projects/personal/u60-monitor/docs/open-issues-2026-07-19.md`, bucket R / §D4–D6). Every claim below was verified against source at that date; verify again before acting.

**Status:** all three DONE (2026-07-19). Kept as the record of what was wrong and why, since two of the three findings were partly misdiagnosed when filed. Worth doing before the ~28 authored-but-unexecuted cycles across u60-monitor plans 008–011 run, because two of the three improve the records those cycles produce.

---

## 1. Cycle-note schema rejects a per-pass reviewer roster — **DONE**

> **Resolved 2026-07-19.** Optional `review-passes[]` added to `cycle-note.schema.json`; `self-review` is now rejected mechanically on every `reviewer-agent-id` via a shared `$defs`; the validator cross-checks roster completeness and renders an actionable message instead of ajv's bare "must NOT be valid". All 201 existing notes still validate. `cycle-orchestration.md` documents the field. One correction to the finding below: cycle 6.1 *did* name its reviewer (`wf:wf_c33477c5-d3a/review-pass-1`) — in the prose summary, not a machine-readable field, which is the same gap but slightly less severe than recorded.

**Priority: highest of the three.** Directly degrades the audit trail of every cycle run from here on.

`tools/docs-gen/schema/cycle-note.schema.json` places `reviewer-agent-id` only inside `reviewer-findings[]`. Its root `additionalProperties: false` therefore **actively rejects** a `review-passes` block — verified by running the validator against a probe note.

Consequences, both live:

- **A no-findings APPROVED pass is unattributable.** There is no slot to name the reviewer, so `.agents/rules/cycle-orchestration.md:55`'s self-review check *structurally cannot fire* on a clean pass — precisely the case where an accidental self-review is easiest to miss.
- **The prose convention has already eroded.** Zero of 201 cycle notes across the monorepo record a per-pass reviewer. Cycle 6.1 — filed *after* the deferral was recorded — has `reviewer-findings: []` and names no agent id at all.

**Fix:** add an optional `review-passes[]` to the schema, each entry carrying at minimum `pass`, `reviewer-agent-id`, `verdict`. Optional, so all 201 existing notes stay valid. Then have the cycle-note writing step populate it — the `tdd-cycle.js` workflow already returns the reviewer id per pass as `wf:<runId>/review-pass-<N>`, so the data exists and is currently discarded.

**Gate:** `npm run validate` and `npm run validate-cycle-note` green across all existing notes; a probe note carrying `review-passes` now validates; a note with a self-reviewing pass fails.

---

## 2. Workflow `args` stringification — one-line defensive fix — **DONE**

> **Resolved 2026-07-19.** REPRODUCED first, as the note below asked: a probe workflow that spawns no agents reported `typeof args === "string"` and `A.cycle === undefined` for an object payload. Guard added to `tdd-cycle.js` and `plan-batch.js` as a small `normalizeArgs()` — `JSON.parse` when the payload arrives as a string, with a clear throw on a non-JSON string rather than a bare `SyntaxError`. Verified against string / object / undefined / null / `"null"` / malformed input, and re-run in a real workflow context (`missing: []`). The inline-wrapper workaround is retired.

**Miscategorised in earlier notes as an upstream Claude Code bug. It is not — it is a missing guard in our own adapter.**

`.claude/workflows/tdd-cycle.js:16` is `const A = args || {}` with no `typeof` check and no `JSON.parse`. When a workflow is invoked by *name* with an object payload, the tool passes it through as a JSON string, so `A.cycle` and friends are `undefined` and the workflow misbehaves in a way that reads like a harness fault.

Verified: never fixed in history; no Claude Code changelog entry through 2.1.210; three consecutive plans re-assert the workaround (an inline `workflow('tdd-cycle', {obj})` wrapper) during active use.

**Fix:** `const A = typeof args === 'string' ? JSON.parse(args) : (args || {})` at `.claude/workflows/tdd-cycle.js:16` and the equivalent line in `.claude/workflows/plan-batch.js:13`. That retires the inline-wrapper workaround entirely.

**Confidence note:** the underlying tool was not exercised directly during the sweep, so the evidence is structural (no defence in the adapter, no fix in history, no changelog entry, three plans working around it) rather than an observed repro. Reproduce before fixing — the fix is safe either way, but the *reason* should be confirmed.

---

## 3. No commit-message length gate — **DONE**

> **Resolved 2026-07-19.** Subject check added to `.agents/scripts/check-commit-command.py`, which both adapters already exec — one implementation, no parity risk. Deliberately conservative: fires only on a statically readable subject, skips `-F`/`-C`/`-c`/`--fixup`/`--squash`/`-t`/editor/shell-expansion. Resolves the `-m "$(cat <<'EOF' … EOF)"` heredoc form, without which it would be decorative. Verified on 20 hand cases + replay against all 118 real subjects: 31/31 over-length caught, ZERO false positives.
>
> **Two corrections to the finding below.** The count is **31 of 118 across both repos** (15 of 33 root, 16 of 85 u60-monitor), not 17 of 78 — the sweep counted one repo. And a **pre-existing, unrelated bug surfaced**: `.codex/hooks/block-commit-flags.sh` resolved its root via `git rev-parse --show-toplevel`, which returns the NESTED project repo when the cwd is inside `projects/<group>/<name>/` — where `.agents/` does not exist. So under Codex the ENTIRE commit policy, `--amend` block included, silently did not run in exactly the directories where most work happens. Both wrappers now resolve from their own location; the Claude one had the same weakness only in its `$(pwd)` fallback.

`.agents/rules/commit.md:7` requires subjects ≤ 50 chars. Nothing enforces it: **17 of 78 subjects exceed it**, including `5ab3248` (51) and `4990804` (63).

The two historical violations recorded in `plan-003.yaml:701` are permanently unfixable — `--amend` is policy-forbidden and hook-blocked — and that row's recorded counts are wrong (the real figures are 56 and 62). Its "pattern avoided" mitigation is also stale: seven more violations have landed since it was written.

**Fix:** add a `commit-msg` hook validating subject length, wired the same way as the existing hooks in `.claude/hooks/` / `.codex/hooks/` with the shared implementation in `.agents/scripts/`. Reject with a message naming the limit and the actual length.

**Design note:** make it a **hard** reject, not a warning. A warning changes nothing here — the rule already exists in writing and is ignored 22% of the time. Ensure it does not fire on merge commits or on the `Co-Authored-By` / `Claude-Session` trailers.

**Related, already done:** the `tdd-cycle.js` `MODELS.mid → MODELS.top` REVIEW patch was committed 2026-07-19 as `81eb021`. Before that, any clean checkout silently ran every code-reviewer pass on the wrong tier.

---

## Sequencing

Independent of each other; all three are small. If only one gets done, do **#1** — it is the only one whose absence silently degrades the record of work already scheduled.

Each lands as its own commit in the root repo, scope `rules` or `chore` per `.agents/rules/commit.md`.

---

## 4. Commit-gate follow-ups (opened 2026-07-19)

Item 3 was adversarially attacked by 4 agents with per-finding verification: **22 claimed breaks, 21 confirmed.** The false positives and the parity blocker were fixed immediately, because those stop work. What follows is the residue, deliberately deferred: they are **false negatives in a forward-only lint**, so each costs at most one over-length subject slipping through, and none can block a commit.

**Fixed at the time (for the record):**

- **Repo-wide blocker, PRE-EXISTING and unrelated to the subject check.** `main()` returned 2 on any `shlex` tokenize failure, so *every* Bash call the lexer choked on was denied — not just commits. `shlex` has no heredoc model, so an unquoted heredoc body containing an odd number of apostrophes ("doesn't") raised `No closing quotation`. Writing prose via `cat <<'EOF'` is this repo's normal authoring path, and English contractions make odd counts the common case. Parity-dependent, so it read as intermittent: 1 or 3 apostrophes blocked, 2 or 4 passed. An attacking agent hit it live on its own first tool call. Now: strip heredoc bodies and retry, and on total failure fail **open** after a narrow scan for `--amend`/`--no-verify`.
- **Codex launcher, blocker.** `.codex/hooks.json` built all three hook paths from `$(git rev-parse --show-toplevel)`, which returns the *nested* project repo when the cwd is inside `projects/<group>/<name>/`. Codex therefore found none of its hooks there — the whole commit policy AND the generated-file policy silently did not run, in exactly the directories where most work happens. Now walks up for `.agents/`. The wrapper scripts were hardened the same way.
- **False positives.** Subshell parens glued onto the preceding token, so `(cd x && git commit -m "…")` measured a subject with a trailing `")`; parens are now segment separators, which also stops `(git commit …)` hiding the commit entirely. And `UNRESOLVABLE` missed bare `$VAR` and ANSI-C `$'…'`, measuring literal text; it is now any `$` or backtick.

**Deferred — false negatives only:**

| # | Gap | Cost |
|---|---|---|
| 4a | `--message` is matched exactly; git accepts any unambiguous abbreviation (`--mess`). | Long subject slips through. |
| 4b | The heredoc-subject regex requires `cat` + whitespace + a `[A-Za-z_]\w*` delimiter. `cat<<EOF` and exotic delimiters miss. | Slips through. |
| 4c | Segments split only on `;&|()`. A newline-joined script is one segment, so a later `git commit` in it can be missed. | Slips through. |
| 4d | The first `-m` is assumed to be the subject. If it is empty, git's `cleanup=whitespace` promotes the *second*. | Slips through. |
| 4e | `subject_of` takes the first non-empty LINE; git's `%s` is the first *paragraph* with newlines folded, so a subject with no blank line before the body is measured short. | Under-measures. |
| 4f | shlex strips embedded double quotes from a heredoc token, shortening the measured subject by one per quote. | Off-by-N under-measure. |

**Also deferred — tooling, not the gate:**

- `validate-agent-config.mjs` only substring-greps `hooks.json` for a literal path and greps the wrapper for a literal script name. It would not have caught either parity break above. Worth making it *execute* the hook against a fixture instead.
- Both wrappers do `cmd=$(jq -r … 2>/dev/null)`, so a missing `jq` silently yields an empty command and the policy fails open. Identical in both adapters, so not a parity break — but it is a silent one.
