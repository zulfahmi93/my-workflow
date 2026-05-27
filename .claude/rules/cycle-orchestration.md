# Cycle orchestration

The manual for running a TDD cycle end-to-end. Pairs with [tdd.md](tdd.md) (phase mechanics + test harness patterns) and [commit.md](commit.md) (commit protocol).

## Pre-cycle reads (always)

1. Repo root `/CLAUDE.md` — auto-loaded; covers layout + wiki schema.
2. Project's `CLAUDE.md` (auto-loaded too) — project-specific data rules, local-dev quirks.
3. This file + [tdd.md](tdd.md) + [commit.md](commit.md).
4. Project plan source — `<project>/docs/plan-NNN.yaml` carries the cycle's spec, status, and session prompt in one file (read the relevant cycle entry). See [docs-site.md](docs-site.md).
5. Cycle status — the YAML cycle's `status:` field.
6. `<project>/docs/cycles/<X.Y>.md` for any prior cycle the current cycle depends on. Read only what matters.
7. Schema / contract / code files the current cycle touches (migrations, prior test files).

TaskList: one task per phase (architect-gate if required, RED, GREEN, REVIEW, REFACTOR, progress-update). Mark `in_progress` on start, `completed` on done.

**Cost discipline:** don't restate this file in subagent prompts. Point at it.

## Architect gate — read from the plan, not from your head

Every cycle in the project's plan file carries an `**Architecture review:**` field on its primary line. Three values:

- **`required (<reviewer>, <one-line reason>)`** — opus gate BEFORE RED. Invoke `software-architect` (or named reviewer). Verdict ≤ 400 words, `GO` / `NO-GO`. Lock decisions into the RED/GREEN spec.
- **`deferred to Cycle <X.Y>`** — sibling cycle inherits the prior verdict. Read the referenced cycle's architect verdict from `<project>/docs/cycles/<X.Y>.md` before RED; do not call architect again.
- **`none — <reason>`** — explicitly trivial. Skip the architect call. Reason MUST be in the plan (e.g. "single pure-function regex normalizer").

**If the field is missing → STOP. Ask the user to mark the cycle in the plan before proceeding.** No orchestrator-side judgment. No silent skip path.

This rule trades a small one-time plan-editing cost for permanent immunity to "I thought this cycle was trivial" drift.

**[Security tier](#security-tier) override:** if the cycle touches any security-tier item, the architect tier is **opus**, regardless of what the plan field says. The plan field should already reflect this; if it doesn't, STOP and ask the user to upgrade it.

## Reviewer separation — never self-review

REVIEW must be performed by a fresh `code-reviewer` sub-agent spawned via the `Agent` tool. The cycle orchestrator MUST NOT review its own work — and "the orchestrator's work" includes everything the orchestrator wrote directly AND everything its RED / GREEN / REFACTOR sub-agents wrote on its behalf. Both share the orchestrator's context and blind spots.

Why this matters:

- A reviewer's job is to catch what the implementer missed. An agent that already read the GREEN diff in its own context has the same blind spots as the implementer.
- The `code-reviewer` sub-agent's **fresh context** is what makes BLOCKER / REFACTOR findings load-bearing. Self-review collapses RED → GREEN → REVIEW into "implementer signs off on implementer" — the gate is silently degraded.
- Self-review APPROVED ≠ separate-reviewer APPROVED. They are not interchangeable, even if the orchestrator's reasoning is careful.

If the `Agent` tool is unavailable in the orchestrator's harness — **STOP** and write `AUTONOMOUS_RUN_STATUS.md`. Do NOT substitute orchestrator-side judgment for a separate REVIEW pass. The cycle is incomplete until a separate `code-reviewer` signs off.

### Permitted orchestrator-side reads (NOT review)

These are not self-review; do not confuse with the rule above:

- **Post-APPROVED sanity check** — orchestrator confirms files exist at expected paths, the test gate passes (`dotnet test` / `pytest`), commit precondition holds. This is commit-precondition verification, not REVIEW.
- **Anti-hallucination guard authoring** — orchestrator drafts the next-pass REVIEW prompt with verified-existing paths + prior gate quote (see [Reviewer hallucination guard](#reviewer-hallucination-guard)). Orchestrator filters reviewer hallucinations against independently-verified state; it does not author findings of its own.
- **Reviewer-prompt assembly** — orchestrator picks the reviewer model + writes the prompt body. Different from authoring the findings.

If a reviewer's findings appear wrong, the next pass goes to a fresh `code-reviewer` (with the anti-hallucination guard injected) — never to the orchestrator's own judgment.

Cycle notes file (§"Reviewer findings + resolution") records reviewer agent ID per pass. If a cycle's notes show "self-review" anywhere in that table, the cycle is non-compliant; the orchestrator must STOP + write a STATUS.md.

## REVIEW checklist

`code-reviewer` evaluates every cycle's GREEN diff against 9 categories: **correctness + test coverage**, **security**, **error handling**, **clarity + maintainability**, **performance**, **dependencies**, **UI cycles** (any `(web)` scope), **API cycles** (any `(api)` scope), and **documentation**. Per-category bullets + the security-tier hook live in [`review-checklist.md`](review-checklist.md) — loaded by the reviewer subagent on demand. Findings tagged per [tdd.md §Reviewer issue tags](tdd.md#reviewer-issue-tags). Categories irrelevant to the cycle are skipped + the reviewer notes it + reason in the verdict.

## Security tier

A cycle is in the security tier if it touches any of:

- Authentication / authorization logic (login, sessions, tokens, RLS, owner-scope checks)
- Cryptographic primitives (signing, HMAC, hashing, encryption, key derivation)
- Secret material (API keys, credentials, env-loaded secrets in code paths)
- Untrusted-input parsing where mishandling enables injection (SQL, XSS, command, path traversal, prototype pollution, SSRF)
- File upload + storage permissions
- Multi-tenant data isolation
- Webhook signature verification

For security-tier cycles:

- **Architecture review tier: opus** (not haiku, not sonnet).
- **Second-pass review: `security-reviewer` agent** in addition to `code-reviewer`. Both must return `APPROVED` before COMMIT.
- **Caveman tone does NOT apply** to security code or to security-tier commit messages. Code stays idiomatic; commit body explains the threat + mitigation.
- **No silent assumptions.** Threat model spelled out in the cycle notes under §"Threat model": what the attacker can do, what the mitigation blocks, what residual risk remains.

## Subagent prompt skeleton

Every RED / GREEN / REVIEW / REFACTOR prompt MUST include:

1. **Paths to read** — root `/CLAUDE.md`, project `CLAUDE.md`, this file, [tdd.md](tdd.md), the plan's §cycle, schema / contract / current-state files. Subagent auto-loads CLAUDE.md from working dir — point at it rather than restate.
2. **Locked decisions** — architect verdict (paste verbatim or reference `<project>/docs/cycles/<X.Y>.md`), prior GREEN report, prior REVIEW findings.
3. **Gate criteria** — what passes, what fails. Concrete (test count, exit code, file paths).
4. **NO-DEFER reminder** — every `[BLOCKER]` / `[REFACTOR]` resolved this cycle. See [tdd.md §Deferral policy](tdd.md#deferral-policy--fix-now-dont-pile-up).
5. **Tone boundary** — caveman is chat-only; subagent writes idiomatic code / tests / commits.
6. **Out-of-bounds** — package additions, test edits in GREEN, schema edits in implementation cycles — list explicitly.

Subagent returns a concise report: files touched, gate result (`Passed: N / Failed: 0`), deviations from spec + reason.

## Reviewer hallucination guard

Reviewers (haiku especially) sometimes fabricate findings — e.g. "tests missing" when files exist in a subdirectory the reviewer skipped, or "import X is unused" when it's transitively required.

Rule: if a reviewer finding contradicts independently-verified state, reject it. The next REVIEW pass prompt MUST inline:

- exact paths the reviewer must verify
- prior gate result quoted (`Passed: N / Failed: 0`)
- pre-emptive `ls <dir>` instruction so the reviewer drills into subdirectories

Reject only when state is independently verified (`ls`, `grep`, `dotnet test`, `pytest`). Genuine findings stand. NO-DEFER still applies.

## Continuing a subagent vs spawning fresh

Prefer `SendMessage` to continue a recent subagent over `Agent` to spawn a fresh one when:

- the same reviewer is doing a second pass on REFACTOR diff
- the same implementer is doing follow-up work on the same files

`SendMessage` reuses the agent's model context + prefix cache → cheaper, lower hallucination risk, and the agent already knows the state.

Spawn a fresh agent when:

- different specialty (RED test author ≠ REVIEW reviewer)
- prior agent ran more than ~30 min ago (cache likely cold)
- prior conversation got long enough that re-reading is cheaper than re-stating

## Cycle notes format

Cycle notes live one-file-per-cycle at `<project>/docs/cycles/<X.Y>.md`. The project's `docs/progress.md` stays as a status table + 1-line summary per cycle — no inline notes.

Each cycle file covers:

- **Outcome** — one sentence + gate result (test count, command).
- **Architect verdict** (when applicable) — verbatim or summarized, with the decisions that were locked.
- **Reviewer findings + how resolved** — `[BLOCKER]` / `[REFACTOR]` / `[NIT]` table, resolution per row, reviewer agent ID per pass.
- **Deviations from plan sketch** — signature changes, scope adds, with one-line rationale each.
- **Reviewer hallucinations rejected** — paths the reviewer claimed were broken, evidence they weren't, prompt-side mitigation applied to the next pass.
- **Follow-ups** — items deferred to a later cycle (must already be tracked in the plan §"Cycle follow-ups" — link).
- **Threat model** — required for [Security tier](#security-tier) cycles only. Lists what an attacker can do, what the mitigation blocks, what residual risk remains.

Commit cost: one cycle = one commit touching `<project>/docs/cycles/<X.Y>.md` + `<project>/docs/progress.md` + the cycle's code. Diff is bounded.

## Definition of done

A cycle is **done** only when ALL of the following hold. If any fails, do not invite the user to COMMIT.

1. **Full test suite green** — not only the new test. See [tdd.md §GREEN gate](tdd.md#green-gate-before-claiming-green-done).
2. **GREEN gate satisfied** — no new warnings, no debug residue, manual smoke pass for UI cycles, real-request smoke for API cycles.
3. **`code-reviewer` returns `APPROVED`** with no `[BLOCKER]` or `[REFACTOR]` items open. If the cycle is in [Security tier](#security-tier), `security-reviewer` ALSO returns `APPROVED`.
4. **Cycle status updated** to reflect the outcome — the cycle's `status:` field in the plan's `plan-NNN.yaml`.
5. **`<project>/docs/cycles/<X.Y>.md`** filed per [Cycle notes format](#cycle-notes-format), including reviewer agent IDs per pass and any rejected hallucinations.
6. **All deferred items tracked** — every `[NIT]` deferred and every follow-up appears in the plan §"Cycle follow-ups". Silent skips are non-compliant.
7. **ADR filed** if the cycle changed architecture (per [review-checklist.md §Documentation](review-checklist.md#documentation)).
8. **Docs HTML regenerated** — after the `progress.md` row update (step 4), run `npm run build -- <project>` from `tools/docs-gen/` so the generated site reflects the new status. See [docs-site.md §When to regenerate](docs-site.md#when-to-regenerate). No-op for projects not yet onboarded to the generator.

The orchestrator confirms (1)–(8) as a post-APPROVED sanity check (this is commit-precondition verification, NOT REVIEW — see [Reviewer separation §Permitted orchestrator-side reads](#permitted-orchestrator-side-reads-not-review)). If any fails, the orchestrator drops back to the appropriate phase (GREEN if a test broke, REFACTOR if a NIT was silently dropped, etc.) rather than proceeding to COMMIT.

## Session protocol (per cycle)

1. User pastes a cycle prompt (e.g. "Begin Cycle 002.1").
2. Claude reads the project's plan cycle spec; orchestrates RED → GREEN → REVIEW → (REFACTOR → REVIEW)* via the right agents until reviewer returns `APPROVED`.
3. Claude updates the project's `progress.md`, creates `docs/cycles/<X.Y>.md`, and regenerates the docs HTML (`npm run build -- <project>`) when the cycle gate is met. Stops.
4. User reviews diffs.
5. User says "commit" → Claude runs the commit protocol (one cycle = one commit). See [commit.md](commit.md).
6. Claude writes the next-cycle prompt; user clears context and pastes it to restart.
