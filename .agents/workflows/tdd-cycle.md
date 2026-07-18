# TDD cycle workflow

Canonical vendor-neutral contract for one plan-driven cycle. Runtime adapters implement this contract; they do not define additional process semantics.

## Inputs

Required: `project`, `projectPath`, `plan`, `cycle`, `greenRole`.

Optional: `redRole` (default `Test Engineer`), `securityTier`, runtime mappings for semantic model tiers (`top`, `mid`), and `notice` — extra text appended to every delegate's preamble.

`notice` exists for isolation: when `projectPath` points at a git worktree rather than the project's primary checkout, every delegate must be told so explicitly. A delegate that edits the primary checkout out of habit corrupts a tree the cycle does not own, and the mistake surfaces only at integration.

## Global invariants

- Read only the target plan cycle plus its declared dependencies and relevant local guides.
- Apply `.agents/rules/tdd.md`, `cycle-orchestration.md`, and `review-checklist.md`.
- Locked architecture decisions bind RED, GREEN, REVIEW, and REFACTOR.
- GREEN never edits RED tests; reviewers never edit files; no blocking finding is deferred.
- Package, schema, or public-contract changes are out of bounds unless the cycle explicitly authorizes them.
- Commits, plan status, cycle-note filing, and generated-doc updates remain outside this workflow.

## Structured records

Runtime adapters must reject unknown fields and require the following shapes:

- Gate: `mode(required|deferred|none|missing)`, `specSummary`, `securityTier`, `noTdd`, `lockedDecisions[]`, optional `reason` and `reviewer`.
- Architect verdict: `verdict(GO|NO-GO)`, `summary`, `lockedDecisions[]`.
- RED: `testFiles[]`, `failingCommand`, `failureLine`, `gateResult`.
- Implementation: `filesTouched[]`, `gateResult`, `command`, `deviations[{change,rationale}]`, optional `notes`.
- REFACTOR: the implementation fields plus `resolutions[{finding,resolution}]`.
- Review verdict: `verdict(APPROVED|NEEDS_FIX)`, `findings[{tag,finding,file?,line?,expectedRemediation?}]`, `skippedCategories[{category,reason}]`; tags are `BLOCKER|REFACTOR|NIT`.
- Finding verification: `refuted`, `evidence`.

## Sequence

### 1. Gate

1. Read the target plan entry and resolve `arch-review` as `required`, `deferred`, `none`, or `missing`.
2. Stop with `architecture-review-field-missing` when absent.
3. Derive the security tier from both input and the canonical trigger list. Stop with `security-tier-plan-mismatch` when security work is marked `none`.
4. For `deferred`, load locked decisions from the referenced cycle note.
5. For `required` or security-tier work not legitimately deferred, delegate the architecture gate at `top` capability. Stop with `architect-no-go` on `NO-GO`.
6. Read the plan's `no-tdd` flag verbatim into `noTdd`. It is reported, never inferred from the spec.

### 2. RED

Skipped entirely when `noTdd` is set: a documentation cycle has no behavior to drive a failing test from, and a test authored to fail on purpose passes the gate mechanically while asserting nothing. The review pass below carries the gate instead.

Otherwise delegate the configured test-author role at `mid` capability. The test must fail for missing or incorrect behavior—not syntax, imports, or infrastructure—and return the exact failure line and command.

### 3. GREEN

Delegate `greenRole` at `mid` capability. Implement the minimum behavior that satisfies the full GREEN gate. Return a gate result in `Passed: N / Failed: 0` form.

When `noTdd` is set this is an AUTHOR pass instead: make only the documentation changes the spec calls for, verify every factual claim against current source before writing it, and let the source win over the spec's own description—recording the discrepancy rather than propagating it. Code and tests stay untouched, and the suite still runs so a stray edit cannot hide.

### 4. REVIEW and REFACTOR loop

Run at most four review passes:

1. Delegate a fresh `Code Reviewer` at `top` capability with no write permission. Every review pass runs at `top`; a cheaper reviewer is what the separation rule exists to prevent.
   When `noTdd` is set, the reviewer runs as a source-verified fact-check: every claim the diff asserts is checked against the cited file and line, an unverifiable claim is a `BLOCKER` rather than a `NIT`, and the test-coverage category is recorded in `skippedCategories`.
2. Derive approval mechanically: `APPROVED` is valid only when there are no `BLOCKER` or `REFACTOR` findings. Stop with `inconsistent-review-verdict` when the claimed verdict contradicts the finding list.
3. Adversarially verify every blocking finding against actual repository state and the implementer's gate command. A finding is refuted only by hard evidence.
4. Stop with `finding-verification-failed` if any finding verifier dies or returns no result; missing verification is never treated as refutation.
5. Record refuted claims with their evidence and inject them into later review prompts as a hallucination guard.
6. If all blocking findings are refuted, run a fresh review pass without changing code.
7. Otherwise delegate `greenRole` to resolve every confirmed finding, rerun the gate, record one resolution per finding, and loop.

Stop with `review-not-approved` if four passes do not reach approval.

### 5. Security review

For security-tier work, run up to two independent `Security Reviewer` passes at `top` capability. Review the security checklist and threat-model completeness. Derive approval from the absence of blocking findings and stop with `inconsistent-security-verdict` when the claimed verdict contradicts the list. After the first consistent failed pass, resolve every blocking security finding and rerun the gate. Stop with `security-review-not-approved` if the second pass is not approved.

## Output

On success return: `approved`, project/plan/cycle identity, resolved security tier, gate summary, architect verdict, RED and GREEN records, all refactors, review log, rejected hallucinations, and security review. Include the runtime's reviewer-ID convention and tell the outer orchestrator to complete the canonical definition of done.

On halt return a stable `halted` code, evidence gathered so far, and enough structured state to write a status handoff. A delegate or child-runtime failure is never converted into approval.

Claude Code's executable adapter is `.claude/workflows/tdd-cycle.js`.
It maps the neutral `greenRole` / `redRole` names to its legacy `greenAgent` / `redAgent` argument keys.
