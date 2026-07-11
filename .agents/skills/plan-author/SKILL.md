---
name: plan-author
description: >
  Authors a new single-source plan-NNN.yaml for a project and onboards it to the docs
  generator: cycles with architect-gate fields, batches / critical-path / file-ownership
  graph data, runbook and overview prose, registry + site-config entries, then the
  validate-and-build gate with inferred graph edges reported for human review. Use when
  the user says "author plan NNN for <project>", "new plan", "write the next plan", or
  invokes the plan-author skill.
---

# Plan author

Writes a project's `docs/plan-NNN.yaml` — the plan's single source of truth — and onboards
it to `tools/docs-gen/`. Canon: [docs-site.md](../../rules/docs-site.md) (especially its
§Onboarding checklist and §Plan-author owns the YAML), the generator's
[README](../../../tools/docs-gen/README.md) (authoritative field reference), and
[`plan.schema.json`](../../../tools/docs-gen/schema/plan.schema.json). Read those first;
this skill never restates them.

## Procedure

1. **Read the canon** above, plus one or two existing plans as exemplars (e.g.
   `projects/personal/ballot-counter/docs/plan-005.yaml`,
   `projects/personal/susun-jadual/docs/plan-001.yaml`).

2. **Author the YAML** at `projects/<group>/<name>/docs/plan-NNN.yaml` per the schema:
   `cycles[]` (id, title, primary owner, `deps`, `status`, phases with model/agent
   assignments, `session.prompt`), plus `batches[]`, `critical-path[]`, per-cycle
   `file-ownership`, `runbook`, and `overview`. Kebab-case keys throughout. Derived views
   (batch table, DAG, ownership matrix, progress dashboard) are never duplicated — the
   cycle is the hub.

3. **Architect gate on EVERY cycle.** Each cycle MUST carry its `arch-review` field
   (`state`: `required` | `deferred` | `none`, plus tier / reviewer / reason /
   deferred-to as the schema demands) — the rendered "Architecture review:" line.
   [cycle-orchestration.md §Architect gate](../../rules/cycle-orchestration.md#architect-gate--read-from-the-plan-not-from-your-head)
   hard-stops any cycle whose field is missing, so a plan that omits one ships a broken
   cycle. Security-tier cycles must already carry the top-tier gate.

4. **Register the plan.** Add `{ "id": "NNN" }` to the project's `plans[]` in
   `tools/docs-gen/projects.config.json`. If the project is new: create its registry
   entry AND `tools/docs-gen/sites/<name>.site.json` with a DISTINCT `accent` +
   `themeKey` (theme persistence is per-project; never reuse another project's key).

5. **Gate.** From `tools/docs-gen/`: `npm run validate`, then
   `npm run build -- <project> <plan>` — both must exit 0. The plan is not done until
   both are green and the diagrams render.

6. **Report inferred graph edges.** Any `deps`, `batches`, or `critical-path` entries not
   stated verbatim in the plan prose are author inference — list each one in the report
   so a human reviewer can check them.
