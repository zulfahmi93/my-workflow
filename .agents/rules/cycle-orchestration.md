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

Every cycle in the project's plan file carries an `**Architecture review:**` field on its primary line. Three values:

- **`required (<reviewer>, <one-line reason>)`** — top-tier gate BEFORE RED (tier→model binding: [lifecycle.md §Model capability tiers](lifecycle.md#model-capability-tiers)). Invoke `software-architect` (or named reviewer). Verdict ≤ 400 words, `GO` / `NO-GO`. Lock decisions into the RED/GREEN spec.
- **`deferred to Cycle <X.Y>`** — sibling cycle inherits the prior verdict. Read the referenced cycle's `architect-verdict` from `<project>/docs/cycles/<X.Y>.yaml` before RED; do not call architect again.
- **`none — <reason>`** — explicitly trivial. Skip the architect call. Reason MUST be in the plan (e.g. "single pure-function regex normalizer").

**If the field is missing → STOP. Ask the user to mark the cycle in the plan before proceeding.** No orchestrator-side judgment. No silent skip path.

This rule trades a small one-time plan-editing cost for permanent immunity to "I thought this cycle was trivial" drift.

**[Security tier](#security-tier) override:** if the cycle touches any security-tier item, the architect tier is **top**, regardless of what the plan field says. The plan field should already reflect this; if it doesn't, STOP and ask the user to upgrade it.

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
- **Anti-hallucination guard authoring** — orchestrator drafts the next-pass REVIEW prompt with verified-existing paths + prior gate quote (see [Reviewer hallucination guard](#reviewer-hallucination-guard)). Orchestrator filters reviewer hallucinations against independently-verified state; it does not author findings of its own.
- **Reviewer-prompt assembly** — orchestrator picks the reviewer model + writes the prompt body. Different from authoring the findings.

If a reviewer's findings appear wrong, the next pass goes to a fresh `code-reviewer` (with the anti-hallucination guard injected) — never to the orchestrator's own judgment.

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

- **Architecture review tier: top** per [lifecycle.md §Model capability tiers](lifecycle.md#model-capability-tiers) (never mid, never cheap).
- **Second-pass review: `security-reviewer` agent** in addition to `code-reviewer`. Both must return `APPROVED` before COMMIT.
- **Caveman tone does NOT apply** to security code or to security-tier commit messages. Code stays idiomatic; commit body explains the threat + mitigation.
- **No silent assumptions.** Threat model spelled out in the cycle notes under §"Threat model": what the attacker can do, what the mitigation blocks, what residual risk remains.

## Subagent prompt skeleton

Every RED / GREEN / REVIEW / REFACTOR prompt MUST include:

1. **Paths to read** — root `/AGENTS.md`, the nearest project-local guide, this file, [tdd.md](tdd.md), the plan's cycle entry, and relevant schema / contract / current-state files. Point at loaded guides rather than restating them.
2. **Locked decisions** — architect verdict (paste verbatim or reference `<project>/docs/cycles/<X.Y>.yaml`), prior GREEN report, prior REVIEW findings.
3. **Gate criteria** — what passes, what fails. Concrete (test count, exit code, file paths).
4. **NO-DEFER reminder** — every `[BLOCKER]` / `[REFACTOR]` resolved this cycle. See [tdd.md §Deferral policy](tdd.md#deferral-policy--fix-now-dont-pile-up).
5. **Tone boundary** — caveman is chat-only; subagent writes idiomatic code / tests / commits.
6. **Out-of-bounds** — package additions, test edits in GREEN, schema edits in implementation cycles — list explicitly.

Subagent returns a concise report: files touched, gate result (`Passed: N / Failed: 0`), deviations from spec + reason.

## Reviewer hallucination guard

Reviewers (cheap-tier especially) sometimes fabricate findings — e.g. "tests missing" when files exist in a subdirectory the reviewer skipped, or "import X is unused" when it's transitively required.

Rule: if a reviewer finding contradicts independently-verified state, reject it. The next REVIEW pass prompt MUST inline:

- exact paths the reviewer must verify
- prior gate result quoted (`Passed: N / Failed: 0`)
- pre-emptive `ls <dir>` instruction so the reviewer drills into subdirectories

Reject only when state is independently verified (`ls`, `grep`, `dotnet test`, `pytest`). Genuine findings stand. NO-DEFER still applies.

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
- `hallucinations-rejected[]` — `{ claim, evidence, mitigation }`: what the reviewer claimed was broken, proof it wasn't, the next-pass prompt mitigation.
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
2. A cycle's `Architecture review:` field is missing from the plan.
3. A security-tier cycle whose plan field doesn't reflect the top-tier gate.
4. A `[BLOCKER]`/`[REFACTOR]` finding requires genuine deferral (needs user approval per [tdd.md §Deferral policy](tdd.md#deferral-policy--fix-now-dont-pile-up)).
5. REVIEW still `NEEDS FIX` after 3 REFACTOR passes, or a reviewer dispute survives the hallucination guard.
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
