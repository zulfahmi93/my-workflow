---
name: cycle
description: >
  Orchestrates one plan-driven TDD cycle end-to-end per cycle-orchestration.md: architect-gate
  check from the plan YAML, RED → GREEN → REVIEW → (REFACTOR → REVIEW)* via the plan's
  per-cycle agent and model-tier assignments, then the full Definition-of-done walk (plan
  status update, validated cycle note, docs-site regen) — stopping short of commit. Use when
  the user says "begin cycle X.Y", "run cycle X.Y", "do cycle X.Y of plan NNN", or invokes
  /cycle (e.g. "/cycle 4.2").
---

# Plan-driven TDD cycle

Runs ONE cycle from a project's `docs/plan-NNN.yaml`, exactly per
[cycle-orchestration.md](../../rules/cycle-orchestration.md). That file is the canon; this
skill is the entry checklist — point at the rule, never restate it (its §Cost discipline).

For ad-hoc TDD outside a plan, use `/tdd` instead (the mirror of that skill's mode check).

## Procedure

1. **Resolve the cycle.** Identify project + plan from cwd/args; locate
   `projects/<group>/<name>/docs/plan-NNN.yaml` and read only the target cycle's entry,
   plus the [§Pre-cycle reads](../../rules/cycle-orchestration.md#pre-cycle-reads-always)
   (prior cycle notes it depends on, schema/contract files it touches).

2. **Architect-gate field check** — per
   [§Architect gate](../../rules/cycle-orchestration.md#architect-gate--read-from-the-plan-not-from-your-head).
   The cycle's `arch-review` field (rendered "Architecture review:") takes three values:
   `required` (run the gate BEFORE RED), `deferred` (read the referenced cycle's verdict;
   don't re-call), `none` (skip; reason must be in the plan). **Field missing → STOP and
   ask the user to mark the plan first.** The security-tier override applies.

3. **TaskList** — one task per phase: architect-gate (if required), RED, GREEN, REVIEW,
   REFACTOR, progress-update.

4. **Execute the phases.** Two paths:
   - **Default — manual orchestration.** Spawn RED / GREEN / REVIEW / REFACTOR subagents
     via the `Agent` tool using the plan's per-cycle agent + model-tier assignments,
     prompts built per [§Subagent prompt skeleton](../../rules/cycle-orchestration.md#subagent-prompt-skeleton).
     Reviewer separation is absolute
     ([§Reviewer separation](../../rules/cycle-orchestration.md#reviewer-separation--never-self-review)):
     REVIEW is always a fresh `code-reviewer`; security-tier cycles add `security-reviewer`.
   - **Optional — the `tdd-cycle` workflow** (`.claude/workflows/tdd-cycle.js`), only when
     the user opts in (says "use the workflow"). Reviewer verdicts return schema-validated;
     record `wf:<runId>/review-pass-<N>` as the `reviewer-agent-id` per
     [§Cycle notes format](../../rules/cycle-orchestration.md#cycle-notes-format).

   Either path loops REFACTOR → REVIEW until `APPROVED`, under the NO-DEFER policy.

5. **After APPROVED — walk the
   [§Definition of done](../../rules/cycle-orchestration.md#definition-of-done) (1)–(8)**
   as the post-APPROVED sanity check. The mechanical tail: update the cycle `status:` in
   the plan YAML; file `docs/cycles/<X.Y>.yaml` and validate it
   (`npm run validate-cycle-note` from `tools/docs-gen/`); regenerate the docs site
   (`npm run build -- <project>` from `tools/docs-gen/`). Any item failing → drop back to
   the right phase; do not invite COMMIT.

6. **STOP before commit.** Present the bounded diff and wait. Committing is the user's
   explicit call per [commit.md](../../rules/commit.md); this skill never commits.
