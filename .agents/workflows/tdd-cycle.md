# TDD cycle workflow

Canonical vendor-neutral contract for one plan-driven cycle. Runtime adapters implement this contract; they do not define additional process semantics.

## Inputs

Required: `project`, `projectPath`, `plan`, `cycle`, `greenRole`.

Optional: `redRole` (default `Test Engineer`), `securityTier`, and runtime mappings for semantic model tiers (`top`, `mid`).

## Global invariants

- Read only the target plan cycle plus its declared dependencies and relevant local guides.
- Apply `.agents/rules/tdd.md`, `cycle-orchestration.md`, and `review-checklist.md`.
- Locked architecture decisions bind RED, GREEN, REVIEW, and REFACTOR.
- GREEN never edits RED tests; reviewers never edit files; no blocking finding is deferred.
- Package, schema, or public-contract changes are out of bounds unless the cycle explicitly authorizes them.
- Commits, plan status, cycle-note filing, and generated-doc updates remain outside this workflow.

## Structured records

Runtime adapters must reject unknown fields and require the following shapes:

- Gate: `mode(required|deferred|none|missing)`, `specSummary`, `securityTier`, `lockedDecisions[]`, optional `reason` and `reviewer`.
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

### 2. RED

Delegate the configured test-author role at `mid` capability. The test must fail for missing or incorrect behavior—not syntax, imports, or infrastructure—and return the exact failure line and command.

### 3. GREEN

Delegate `greenRole` at `mid` capability. Implement the minimum behavior that satisfies the full GREEN gate. Return a gate result in `Passed: N / Failed: 0` form.

### 4. REVIEW and REFACTOR loop

Run at most four review passes:

1. Delegate a fresh `Code Reviewer` at `mid` capability with no write permission.
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
