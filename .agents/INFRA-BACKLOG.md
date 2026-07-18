# Monorepo infra backlog

Small, cross-cutting fixes to the shared agent machinery — `tools/docs-gen/`, `.agents/`, `.claude/`. These affect **every project in the repo**, not one nested project, which is why they cannot live in a project plan.

Surfaced 2026-07-19 by the u60-monitor open-issue sweep (`projects/personal/u60-monitor/docs/open-issues-2026-07-19.md`, bucket R / §D4–D6). Every claim below was verified against source at that date; verify again before acting.

**Status:** item 1 DONE (`schema` + validator + rule doc). Items 2 and 3 not started. Worth doing before the ~28 authored-but-unexecuted cycles across u60-monitor plans 008–011 run, because two of the three improve the records those cycles produce.

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

## 2. Workflow `args` stringification — one-line defensive fix

**Miscategorised in earlier notes as an upstream Claude Code bug. It is not — it is a missing guard in our own adapter.**

`.claude/workflows/tdd-cycle.js:16` is `const A = args || {}` with no `typeof` check and no `JSON.parse`. When a workflow is invoked by *name* with an object payload, the tool passes it through as a JSON string, so `A.cycle` and friends are `undefined` and the workflow misbehaves in a way that reads like a harness fault.

Verified: never fixed in history; no Claude Code changelog entry through 2.1.210; three consecutive plans re-assert the workaround (an inline `workflow('tdd-cycle', {obj})` wrapper) during active use.

**Fix:** `const A = typeof args === 'string' ? JSON.parse(args) : (args || {})` at `.claude/workflows/tdd-cycle.js:16` and the equivalent line in `.claude/workflows/plan-batch.js:13`. That retires the inline-wrapper workaround entirely.

**Confidence note:** the underlying tool was not exercised directly during the sweep, so the evidence is structural (no defence in the adapter, no fix in history, no changelog entry, three plans working around it) rather than an observed repro. Reproduce before fixing — the fix is safe either way, but the *reason* should be confirmed.

---

## 3. No commit-message length gate

`.agents/rules/commit.md:7` requires subjects ≤ 50 chars. Nothing enforces it: **17 of 78 subjects exceed it**, including `5ab3248` (51) and `4990804` (63).

The two historical violations recorded in `plan-003.yaml:701` are permanently unfixable — `--amend` is policy-forbidden and hook-blocked — and that row's recorded counts are wrong (the real figures are 56 and 62). Its "pattern avoided" mitigation is also stale: seven more violations have landed since it was written.

**Fix:** add a `commit-msg` hook validating subject length, wired the same way as the existing hooks in `.claude/hooks/` / `.codex/hooks/` with the shared implementation in `.agents/scripts/`. Reject with a message naming the limit and the actual length.

**Design note:** make it a **hard** reject, not a warning. A warning changes nothing here — the rule already exists in writing and is ignored 22% of the time. Ensure it does not fire on merge commits or on the `Co-Authored-By` / `Claude-Session` trailers.

**Related, already done:** the `tdd-cycle.js` `MODELS.mid → MODELS.top` REVIEW patch was committed 2026-07-19 as `81eb021`. Before that, any clean checkout silently ran every code-reviewer pass on the wrong tier.

---

## Sequencing

Independent of each other; all three are small. If only one gets done, do **#1** — it is the only one whose absence silently degrades the record of work already scheduled.

Each lands as its own commit in the root repo, scope `rules` or `chore` per `.agents/rules/commit.md`.
