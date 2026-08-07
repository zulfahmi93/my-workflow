# Cycle orchestration

The manual for running a TDD cycle end-to-end. Pairs with [tdd.md](tdd.md) (phase mechanics + test harness patterns) and [commit.md](commit.md) (commit protocol).

## Pre-cycle reads (always)

1. Repo root `/AGENTS.md` — the canonical shared guide; do not re-read when the runtime already loaded it.
2. The nearest project-local guide — prefer `AGENTS.md`; honor a legacy provider guide when it is the only source of project-specific rules.
3. This file + [tdd.md](tdd.md) + [commit.md](commit.md) — read on demand; once per session is enough.
4. Project plan source — `<project>/docs/plan-NNN.yaml` carries the cycle's spec, status, and session prompt in one file (read the relevant cycle entry). See [docs-site.md](docs-site.md).
5. Cycle status — the YAML cycle's `status:` field.
6. `<project>/docs/cycles/<X.Y>.yaml` for any prior cycle the current cycle depends on. Read only what matters.
7. Schema / contract / code files the current cycle touches (migrations, prior test files).

Maintain one task per phase (architect-gate if required, RED, GREEN, REVIEW, REFACTOR, progress-update). Mark the active phase in progress and completed phases done.

**Cost discipline:** don't restate this file in subagent prompts. Point at it.

## Architect gate — read from the plan, not from your head

Every cycle in the project's `docs/plan-NNN.yaml` carries an `arch-review:` mapping — required by [`plan.schema.json`](../../tools/docs-gen/schema/plan.schema.json) `$defs.cycle`, and the first thing the [`tdd-cycle` workflow](../workflows/tdd-cycle.md) gate phase reads. Its `state:` takes three values:

```yaml
- id: "007.1"
  arch-review:
    state: required          # required | none | deferred
    tier: opus               # top | mid | opus | sonnet (opus→top, sonnet→mid)
    reviewer: software-architect
    reason: first code in the repo that ORIGINATES webhook signatures
```

- **`state: required`** — top-tier gate BEFORE RED (tier→model binding: [lifecycle.md §Model capability tiers](lifecycle.md#model-capability-tiers)). `tier:` is schema-mandatory here; `reviewer:` names the agent and `reason:` gives the one-line why. Invoke `software-architect` (or the named reviewer). Verdict ≤ 400 words, `GO` / `NO-GO`. Lock decisions into the RED/GREEN spec.
- **`state: deferred`** + **`deferred-to: "<X.Y>"`** — sibling cycle inherits the prior verdict. Read the referenced cycle's `architect-verdict` from `<project>/docs/cycles/<X.Y>.yaml` before RED; do not call architect again. `deferred-to` may point at a cycle in an earlier plan of the same project (kobu-bot 004.3 → 002.10) — cycle notes are keyed by cycle id, not by plan.
- **`state: none`** — explicitly trivial. Skip the architect call. `reason:` MUST be in the plan (e.g. "single pure-function regex normalizer"); the schema does not enforce it, this rule does.

**If the `arch-review` mapping is missing → STOP. Ask the user to mark the cycle in the plan before proceeding.** No orchestrator-side judgment. No silent skip path. **Same STOP for a dangling `deferred-to`** — a target cycle that does not exist, or whose own `arch-review.state` is anything but `required`: the chain then terminates in no verdict, so there is nothing to inherit. This one IS checked mechanically now: `npm run validate` (`generate.mjs --validate`) resolves every `deferred-to` against an index of all of the project's plans — a deferral may legitimately point backwards into an earlier plan — and fails unless the target exists with `state: required`. Validate path only; `build` does not check it. The check exists because kobu-bot 004.10, the live smoke on a paying client's production WABA, sat deferred to 001.15 (`state: none`, never run, no cycle note) through every green validate run. Still read the target's `architect-verdict` before RED as the deferred branch already tells you to — the validator proves a verdict is owed, not that it says what you assumed.

This rule trades a small one-time plan-editing cost for permanent immunity to "I thought this cycle was trivial" drift.

Read the YAML key, never the rendered label. This section used to describe the field as `**Architecture review:**` "on the cycle's primary line", with prose values like `deferred to Cycle 2.1` — the MD-triad plan format the plans left behind; `Architecture review.` now survives only as a string the docs generator prints. Some plans (susun-jadual 001, isc-workflow-web 001–004, landing-website 001) still restate the gate as `Architecture review:` prose inside the cycle body, a migration leftover that is narration and can drift from the mapping; the other plans carry none at all. `arch-review` is what the schema requires and the workflow reads.

**[Security tier](#security-tier) override:** if the cycle touches any security-tier item, the architect tier is **top**, regardless of what `arch-review` says. `arch-review.tier` should already reflect this; if it doesn't, STOP and ask the user to upgrade it. (`state: none` on a security-tier cycle is the same stop — the workflow halts it as `security-tier-plan-mismatch`.)

## Reviewer separation — never self-review

REVIEW must be performed by a fresh `code-reviewer` delegate using the runtime's independent-agent mechanism. The cycle orchestrator MUST NOT review its own work — and "the orchestrator's work" includes everything the orchestrator wrote directly AND everything its RED / GREEN / REFACTOR delegates wrote on its behalf. Both share the orchestrator's context and blind spots.

Why this matters:

- A reviewer's job is to catch what the implementer missed. An agent that already read the GREEN diff in its own context has the same blind spots as the implementer.
- The `code-reviewer` sub-agent's **fresh context** is what makes BLOCKER / REFACTOR findings load-bearing. Self-review collapses RED → GREEN → REVIEW into "implementer signs off on implementer" — the gate is silently degraded.
- Self-review APPROVED ≠ separate-reviewer APPROVED. They are not interchangeable, even if the orchestrator's reasoning is careful.

If independent delegation is unavailable in the runtime — **STOP** and write `AUTONOMOUS_RUN_STATUS.md`. Do NOT substitute orchestrator-side judgment for a separate REVIEW pass. The cycle is incomplete until a separate `code-reviewer` signs off.

### Permitted orchestrator-side reads (NOT review)

These are not self-review; do not confuse with the rule above:

- **Post-APPROVED sanity check** — orchestrator confirms files exist at expected paths, the test gate passes (`dotnet test` / `pytest`), commit precondition holds. This is commit-precondition verification, not REVIEW.
- **Anti-hallucination guard assembly** — orchestrator drafts the next-pass REVIEW prompt with verified-existing paths, the prior gate quote, and the refuted claims + evidence the `finding-verifier` returned (see [Reviewer hallucination guard](#reviewer-hallucination-guard)). It assembles that block; it does not make the refuted/confirmed call and does not author findings of its own.
- **Reviewer-prompt assembly** — orchestrator picks the reviewer model + writes the prompt body. Different from authoring the findings.

If a reviewer's findings appear wrong, the call goes to the [`finding-verifier`](#reviewer-hallucination-guard) and the next pass to a fresh `code-reviewer` (with the guard block injected) — never to the orchestrator's own judgment.

The cycle-note YAML's `reviewer-findings[].reviewer-agent-id` records the reviewer agent ID per pass. If a cycle's notes show "self-review" as a reviewer-agent-id anywhere, the cycle is non-compliant; the orchestrator must STOP + write a STATUS.md. **This is now enforced by the schema** — a self-review value fails `npm run validate-cycle-note` rather than relying on a human catching it in a diff.

**Record every REVIEW pass in `review-passes[]`, including passes that returned zero findings.** `reviewer-agent-id` also lives inside `reviewer-findings[]`, but a clean APPROVED pass produces no finding and therefore named nobody — so the one case where an accidental self-review is easiest to miss was exactly the case the rule above could not detect. Each entry takes `pass`, `reviewer-agent-id` and `verdict` (`APPROVED` / `NEEDS FIX`), plus optional `role`, `model` and `findings-count`:

```yaml
review-passes:
  - pass: 1
    reviewer-agent-id: "wf:wf_c33477c5-d3a/review-pass-1"
    verdict: APPROVED
    role: code-reviewer
    model: opus
    findings-count: 0
```

The field is optional so notes filed before it existed stay valid, but **once supplied the roster must be complete**: the validator rejects a note whose `reviewer-findings` reference a pass with no roster entry, since a partial roster reads as full attribution while hiding one. Security-tier cycles list the `security-reviewer` second pass as its own entry.

When a runtime implements [the neutral `tdd-cycle` workflow](../workflows/tdd-cycle.md), reviewer verdicts should return as schema-validated structured output so findings land in the cycle note mechanically. Record `wf:<runId>/review-pass-<N>` as the `reviewer-agent-id` when the runtime exposes a workflow run ID.

## REVIEW checklist

`code-reviewer` evaluates every cycle's GREEN diff against 9 categories: **correctness + test coverage**, **security**, **error handling**, **clarity + maintainability**, **performance**, **dependencies**, **UI cycles** (any `(web)` or `(app)` scope), **API cycles** (any `(api)` scope), and **documentation**. Per-category bullets + the security-tier hook live in [`review-checklist.md`](review-checklist.md) — loaded by the reviewer subagent on demand. Findings tagged per [tdd.md §Reviewer issue tags](tdd.md#reviewer-issue-tags). Categories irrelevant to the cycle are skipped + the reviewer notes it + reason in the verdict.

## Security tier

A cycle is in the security tier if it touches any of:

- Authentication / authorization logic (login, sessions, tokens, RLS, owner-scope checks)
- Cryptographic primitives (signing, HMAC, hashing, encryption, key derivation)
- Secret material (API keys, credentials, env-loaded secrets in code paths)
- Untrusted-input parsing where mishandling enables injection (SQL, XSS, command, path traversal, prototype pollution, SSRF)
- File upload + storage permissions
- Multi-tenant data isolation
- Webhook signature verification
- Prompt-injection surface — untrusted text (user messages, retrieved documents, file contents, scraped pages) entering LLM context
- LLM tool-use authorization — model-triggered side effects, tool permission boundaries, model output driving actions without validation

For security-tier cycles:

- **Architecture review tier: top** per [lifecycle.md §Model capability tiers](lifecycle.md#model-capability-tiers) (never mid — and there is no tier below it).
- **Second-pass review: `security-reviewer` agent** in addition to `code-reviewer`. Both must return `APPROVED` before COMMIT.
- **Caveman tone does NOT apply** to security code or to security-tier commit messages. Code stays idiomatic; commit body explains the threat + mitigation.
- **No silent assumptions.** Threat model spelled out in the cycle notes under §"Threat model": what the attacker can do, what the mitigation blocks, what residual risk remains.

## Subagent prompt skeleton

Every RED / GREEN / REVIEW / REFACTOR prompt MUST include:

1. **Paths to read** — root `/AGENTS.md`, the nearest project-local guide, this file, [tdd.md](tdd.md), the plan's cycle entry, and relevant schema / contract / current-state files. Point at loaded guides rather than restating them.
2. **Locked decisions** — architect verdict (paste verbatim or reference `<project>/docs/cycles/<X.Y>.yaml`), prior GREEN report, prior REVIEW findings.
3. **Gate criteria** — what passes, what fails. Concrete (test count, exit code, file paths).
4. **NO-DEFER reminder** — every `[BLOCKER]` / `[REFACTOR]` resolved this cycle. See [tdd.md §Deferral policy](tdd.md#deferral-policy--fix-now-dont-pile-up). On a `no-tdd` cycle, say so and state the substituted gate — the reviewer's fact-check is the only gate there, and an unverifiable claim is a `[BLOCKER]`. See [tdd.md §Cycles without RED](tdd.md#cycles-without-red-no-tdd).
5. **Tone boundary** — caveman is chat-only; subagent writes idiomatic code / tests / commits.
6. **Out-of-bounds** — package additions, test edits in GREEN, schema edits in implementation cycles — list explicitly.

Subagent returns a concise report: files touched, gate result (`Passed: N / Failed: 0`), deviations from spec + reason.

## Reviewer hallucination guard

Reviewers sometimes fabricate findings — e.g. "tests missing" when files exist in a subdirectory the reviewer skipped, or "import X is unused" when it's transitively required. (This used to be qualified "cheap-tier especially"; that tier is gone, and REVIEW runs at `top` regardless, so the guard applies to every pass.) Both false `[BLOCKER]`s this repo has recorded (isc-workflow-web 1.8, kobu-bot 005.3) were wrong-baseline errors: diffed against `HEAD` instead of the working tree, or blamed this cycle for a sibling cycle's files.

The guard is a **delegate, not an orchestrator judgement call**. After a REVIEW pass returns `NEEDS FIX`, that pass's blocking findings (`[BLOCKER]` + `[REFACTOR]`; `[NIT]`s are not verified) go to a [`finding-verifier`](../roles/finding-verifier.md) before any implementer spends a REFACTOR pass on them. It runs on every such pass, not only on disputes.

- **Read-only, holding no review context.** The verifier runs commands and reads files; it never edits, creates, commits, or branches. It does not inherit the implementer clauses the other delegates get — a refuter told "every finding is resolved this cycle" is pointed at the opposite of its job — but it MUST inherit the working-directory notice, because a verifier running the gate command in the wrong tree refutes findings against code the cycle does not own. `pwd` before trusting any gate output.
- **One verdict per finding, each judged alone.** One verifier per pass, not one per finding: the per-finding fan-out spent 16 delegates over four passes on cycle 8.3 and every refutation on record was a self-contained single-claim check. Sharing a file is not sharing a fate, and verifying one finding licenses no opinion on the others — or on the diff.
- **`refuted: true` needs hard evidence** that the finding misstates repo state. The first check is re-running the reviewer's own stated evidence command (every finding carries one); if it does not reproduce the claim, that is a refutation. Plausible-but-unverified stays confirmed — an unverifiable finding survives, because a wasted REFACTOR pass costs less than a real defect dismissed on a hunch. Evidence is the exact command and the exact output line that decided it, never a summary of what it would show.
- **Right for the wrong reason is confirmed, not refuted.** Where the defect is real but the stated cause is wrong, the finding stands and the failed explanation is named. kobu-bot 001.10 is the precedent: `parseCookies` did not store the space-prefixed key the reviewer blamed, but the dead double-lookup it pointed at was real — the removal shipped, only the explanation was struck.
- **Missing verification is never refutation.** Every blocking finding needs exactly one usable verdict; a missing, duplicated, or out-of-range one halts the cycle (`finding-verification-failed`) instead of quietly dropping the finding.

Confirmed findings go to REFACTOR under NO-DEFER, unchanged. **Refuted findings are dropped with no REFACTOR pass and recorded in the cycle note's [`hallucinations-rejected[]`](#cycle-notes-format)** — claim, evidence, mitigation. That is the one path by which a `[BLOCKER]` legitimately leaves a cycle unfixed, so the record is the audit trail: a refutation with no evidence string is indistinguishable from a finding that was ignored. Rejected claims and their evidence are inlined into every later REVIEW prompt along with the standing gate result, so the same fabrication is not re-raised — that inlining is the orchestrator's whole job here (see [Permitted orchestrator-side reads](#permitted-orchestrator-side-reads-not-review)); it assembles the prompt, it does not decide the verdict.

A pass whose blocking findings are **all** refuted changed no code, so it does not consume the productive-review budget of [stop condition 5](#stop-conditions--halt--write-status): REVIEW re-runs with the guard block inlined, charged instead to `maxRefutedOnlyPasses` (default 3). Reaching that bound halts the cycle as `reviewer-hallucination-loop` — the reviewer is not converging on real defects and a human must read the rejected claims. Without the split, a hallucinating reviewer burned the budget meant for genuine convergence and the halt read as "reviewer dispute" on a cycle that had nothing wrong with it.

The verifier is not a review pass and never substitutes for one: a cycle whose only independent check was verification has not been reviewed. If the runtime cannot delegate it, the orchestrator may still filter findings against independently-verified state (`ls`, `grep`, `dotnet test`, `pytest`) and must record the rejection the same way — but it never authors findings, and "I would not have flagged that" is not a refutation.

## Continuing a subagent vs spawning fresh

Prefer the runtime's continuation mechanism over spawning a fresh delegate when:

- the same reviewer is doing a second pass on REFACTOR diff
- the same implementer is doing follow-up work on the same files

Continuation reuses the delegate's context and often its prefix cache, reducing cost and re-reading.

Spawn a fresh agent when:

- different specialty (RED test author ≠ REVIEW reviewer)
- prior agent ran more than ~30 min ago (cache likely cold)
- prior conversation got long enough that re-reading is cheaper than re-stating

## Cycle notes format

Cycle notes live one-file-per-cycle at `<project>/docs/cycles/<X.Y>.yaml` — a structured, kebab-case YAML record validated against [`tools/docs-gen/schema/cycle-note.schema.json`](../../tools/docs-gen/schema/cycle-note.schema.json). They are **execution-only**: read by the orchestrator/reviewer during the cycle and reviewed by the human at commit-time via the diff; they are NOT rendered into the docs HTML site (the plan YAML's `status:` already drives the progress dashboard). Per-cycle status lives in the plan YAML's cycle `status:` field — there is no separate `progress.md`.

Top-level keys (full schema in `cycle-note.schema.json`):

- `project`, `cycle` (`<X.Y>`, must match the filename), `title`, `security-tier` (bool).
- `outcome` — `{ summary (one sentence), gate (e.g. "Passed: 12 / Failed: 0"), command }`.
- `architect-verdict` (when applicable) — `{ verdict: GO|NO-GO, tier, reviewer, summary, locked-decisions[] }`.
- `reviewer-findings[]` — one row per finding: `{ tag: BLOCKER|REFACTOR|NIT, finding, resolution, pass, reviewer-agent-id }`. The `reviewer-agent-id` per pass is the self-review guard (see [Reviewer separation](#reviewer-separation--never-self-review)).
- `deviations[]` — `{ change, rationale }`: signature changes, scope adds.
- `hallucinations-rejected[]` — `{ claim, evidence, mitigation? }`: what the reviewer claimed was broken, the [verifier's](#reviewer-hallucination-guard) proof it wasn't, the next-pass prompt mitigation. A dropped blocking finding appears nowhere else, so an entry with no real evidence string reads exactly like a finding that was ignored.
- `follow-ups[]` — `{ item, tracked-in }`: deferred items, each already tracked in the plan §"Cycle follow-ups" (`cycle-followups:`).
- `threat-model` — `{ attacker-can[], mitigation-blocks[], residual-risk[] }`. **Required** for [Security tier](#security-tier) cycles (schema enforces it when `security-tier: true`).

Validate before commit: `npm run validate-cycle-note -- <project>/docs/cycles/<X.Y>.yaml` from `tools/docs-gen/` (exits 1 on a bad enum, unknown key, missing required field, or a security-tier note without a threat model).

Commit cost: one cycle = one commit touching `<project>/docs/cycles/<X.Y>.yaml` + the plan YAML (cycle `status:` update) + the cycle's code. Diff is bounded.

## Definition of done

A cycle is **done** only when ALL of the following hold. If any fails, do not invite the user to COMMIT.

1. **Full test suite green** — not only the new test. See [tdd.md §GREEN gate](tdd.md#green-gate-before-claiming-green-done).
2. **GREEN gate satisfied** — no new warnings, no debug residue, manual smoke pass for UI cycles, real-request smoke for API cycles.
3. **`code-reviewer` returns `APPROVED`** with no `[BLOCKER]` or `[REFACTOR]` items open. If the cycle is in [Security tier](#security-tier), `security-reviewer` ALSO returns `APPROVED`.
4. **Cycle status updated** to reflect the outcome — the cycle's `status:` field in the plan's `plan-NNN.yaml`.
5. **`<project>/docs/cycles/<X.Y>.yaml`** filed per [Cycle notes format](#cycle-notes-format) and passing `npm run validate-cycle-note`, including reviewer agent IDs per pass and any rejected hallucinations.
6. **All deferred items tracked** — every `[NIT]` deferred and every follow-up appears in the plan §"Cycle follow-ups". Silent skips are non-compliant.
7. **ADR filed** if the cycle changed architecture (per [review-checklist.md §Documentation](review-checklist.md#documentation)).
8. **Docs HTML regenerated** — after the cycle `status:` update in the plan YAML (step 4), run `npm run build -- <project>` from `tools/docs-gen/` so the generated site reflects the new status. See [docs-site.md §When to regenerate](docs-site.md#when-to-regenerate). No-op for projects not yet onboarded to the generator.

The orchestrator confirms (1)–(8) as a post-APPROVED sanity check (this is commit-precondition verification, NOT REVIEW — see [Reviewer separation §Permitted orchestrator-side reads](#permitted-orchestrator-side-reads-not-review)). If any fails, the orchestrator drops back to the appropriate phase (GREEN if a test broke, REFACTOR if a NIT was silently dropped, etc.) rather than proceeding to COMMIT.

## Session protocol (per cycle)

1. User pastes a cycle prompt (e.g. "Begin Cycle 002.1").
2. The orchestrator reads the project's plan cycle spec and runs RED → GREEN → REVIEW → (REFACTOR → REVIEW)* through the assigned roles until the reviewer returns `APPROVED`.
3. The orchestrator updates the cycle `status:` in the plan YAML, files `docs/cycles/<X.Y>.yaml` (validated via `npm run validate-cycle-note`), and regenerates the docs HTML (`npm run build -- <project>`) when the cycle gate is met. Stops.
4. User reviews diffs.
5. User says "commit" → the orchestrator runs the commit protocol (one cycle = one commit). See [commit.md](commit.md).
6. The orchestrator writes the next-cycle prompt; the user starts a fresh context when appropriate.

## Autonomous run protocol

An autonomous run executes a contiguous range of plan cycles without per-cycle user check-ins, committing once per completed cycle. It is the **only** sanctioned exception to [commit.md](commit.md) "never auto-commit" — and only inside the boundaries below. The `autonomous-run` skill implements this protocol.

### Authorization (all three required, before cycle 1)

- **Explicit cycle range** — e.g. "run cycles 4.1 → 4.13". No open-ended "run the plan".
- **Explicit commit grant** — the user says commits are included (e.g. "auto-commit between cycles"). Without it, the run stops before each COMMIT like a normal session.
- **Session-scoped** — authorization covers this run only; it does not carry to another plan, another range, or another session.

### Per-cycle obligations (unchanged)

Every cycle in the run satisfies the full [Definition of done](#definition-of-done) (1)–(8) before its commit. One cycle = one commit per [commit.md](commit.md). The architect gate, reviewer separation, security tier, and NO-DEFER rules apply exactly as in interactive mode — autonomy never relaxes a gate.

### Stop conditions — halt + write STATUS

Halt the run and write `<project>/docs/AUTONOMOUS_RUN_STATUS.md` when ANY of:

1. Architect returns `NO-GO`.
2. A cycle's `arch-review` mapping is missing from the plan, or its `deferred-to` points at a cycle with no verdict to inherit (see [§Architect gate](#architect-gate--read-from-the-plan-not-from-your-head)).
3. A security-tier cycle whose `arch-review.tier` doesn't reflect the top-tier gate.
4. A `[BLOCKER]`/`[REFACTOR]` finding requires genuine deferral (needs user approval per [tdd.md §Deferral policy](tdd.md#deferral-policy--fix-now-dont-pile-up)).
5. REVIEW still `NEEDS FIX` once the review budget is spent, or a reviewer dispute survives the [hallucination guard](#reviewer-hallucination-guard). The budget is `maxReviewPasses` **productive** passes — a pass whose findings survived verification and drove a REFACTOR; refuted-only passes are charged to `maxRefutedOnlyPasses` instead and halt as `reviewer-hallucination-loop`. The [`tdd-cycle` workflow](../workflows/tdd-cycle.md) is the authority on both defaults (6 and 3 as this is written) and its halt cites this condition by number, so quote the constants here rather than a literal: this line read "after 3 REFACTOR passes" while the code ran 6, and the number in a rule nobody can run drifts silently from the one that halts the cycle.
6. The test gate cannot reach green for a reason outside the cycle's scope.
7. A pre-commit hook fails (fix-forward needs user eyes; never `--amend`, never `--no-verify`).
8. The cycle's spec demands out-of-bounds changes (schema edits in an implementation cycle, package additions not in the plan).

### STATUS file format

`AUTONOMOUS_RUN_STATUS.md` records: plan + authorized range; one line per completed cycle (`<X.Y> — committed <sha>`); the halted cycle + phase; the stop condition hit (numbered from the list above); evidence (gate output, reviewer finding, or failing command — quoted verbatim); proposed next action. It is a handoff to the human, not a log.

### Resume

User reviews STATUS + diffs, resolves the blocker, re-authorizes with the remaining range. The run never resumes itself.

### Never, even when authorized

**Hook-enforced** — the commit gate returns exit 2 on these, in interactive and autonomous runs alike:

- `--amend` and `--no-verify` / `-n` on a commit.
- Force pushes: `--force`, `--force-with-lease`, `--force-if-includes`, `-f`, and any unambiguous abbreviation of them.
- `gh pr create` and `gh pr merge`.

**Advisory — not enforced, and the run is on its honour:**

- Plain `git push`. Deliberately left open: pushing `zulfahmi-portfolio` to `main` is what deploys zulfahmi.dev, so a blanket block would break a real workflow to close a theoretical hole. An autonomous run still must not push.
- Commits outside the cycle's bounded diff (code + plan `status:` + cycle note). No gate can see the cycle's bounds.

The split is deliberate. These were one list, of which two items were enforced and three were not — so the unenforced ones borrowed the credibility of the enforced ones, and seven repos with live GitHub remotes were protected by nothing but compliance. If you add an item here, put it under the heading that matches reality.
