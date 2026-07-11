# Plan batch workflow

Canonical vendor-neutral contract for one batch from a project plan.

## Inputs

Required: `project`, `projectPath`, `plan`, `batch`.

Optional: a restricted cycle list with per-cycle `greenRole`, `redRole`, or `securityTier` overrides, plus runtime mappings for semantic model tiers.

## Preflight record

The preflight returns only:

- `ok`
- `notes`
- `testCollisionRisk`
- `cycles[{cycle,greenRole,redRole?,securityTier}]`

Unknown fields are rejected.

## Preflight

1. Read the target batch and list its cycles in plan order.
2. Resolve implementation and optional test-author roles from `.agents/roles/` and security tier from the plan plus canonical trigger list.
3. Set `ok=false` when any dependency is unfinished, two cycles claim overlapping files, or an architecture-review field is missing.
4. Set `testCollisionRisk=true` when cycles may contend for a database, fixed port, development server, shared fixture, or any other non-isolated test resource. Uncertainty resolves to `true`.
5. Apply explicit cycle restrictions and overrides only after validating the plan-derived record.

Stop with `preflight-failed` when `ok=false`.

## Execution

Each selected cycle runs through the canonical [TDD cycle workflow](tdd-cycle.md).

- When `testCollisionRisk=true`, run sequentially in plan order and stop after the first halted child.
- Otherwise run concurrently only because file ownership is disjoint and test resources are isolated.
- Convert a child-runtime exception into `child-workflow-error`; never treat it as approval.
- Preserve every completed and halted child record.

## Output

Return `batch`, `completed[]`, `halted[]`, and `results[]`. The outer orchestrator—not the batch runtime—performs each completed cycle's definition-of-done work: plan status, validated cycle note, documentation regeneration, and any separately authorized commit.

Claude Code's executable adapter is `.claude/workflows/plan-batch.js`.
It maps neutral role names to its legacy `greenAgent` / `redAgent` child-workflow keys.
