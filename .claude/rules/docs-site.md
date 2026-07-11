# Docs HTML site

How the planning docs become a browsable HTML site, and when to regenerate it. Loaded on-demand when authoring a plan or completing a cycle. Pairs with [cycle-orchestration.md](cycle-orchestration.md) (§Definition of done references this) and the generator's own [`tools/docs-gen/README.md`](../../tools/docs-gen/README.md) (authoritative schema).

A plan's **source of truth** is a single YAML file: `projects/<group>/<name>/docs/plan-NNN.yaml`. One structured file holds cycles (the hub: id/title/owner/deps/`status`/phases/session-prompt), batches, critical-path, file-ownership, runbook prose, and overview. The batch table, dependency DAG, file-ownership matrix, and progress dashboard are **derived views**, never second copies — this is what kills the cross-file drift the old multi-file format suffered. Validated against [`tools/docs-gen/schema/plan.schema.json`](../../tools/docs-gen/schema/plan.schema.json) on every build (`npm run validate`); a bad enum, unknown key, or dangling cycle ref fails the build.

All current plans are YAML — [`projects.config.json`](../../tools/docs-gen/projects.config.json) is the authoritative registry of onboarded projects and plans (never enumerate them in prose; prose copies drift). The legacy MD-triad format (`plan-NNN.md` + progress + `parallel-batches-NNN.md` + `meta.json`) and its parser were **removed** — the generator consumes YAML only; pointing it at a plan id with no `plan-NNN.yaml` fails with a clear error. New plans are authored directly as YAML.

The HTML under `projects/<group>/<name>/docs/html/` is **generated output** — never hand-edit it; edit the YAML source and regenerate.

## The generator

Repo-root tool at [`tools/docs-gen/`](../../tools/docs-gen/) — a self-contained Node project (yaml + ajv + markdown-it + chokidar). Config-driven, serves every onboarded project. Reads each plan's `plan-NNN.yaml` + per-project `site.json`, validates the YAML, renders its prose fields (markdown-it) and passes code/prompts through verbatim, and emits an offline, accessible, light/dark HTML site (cycle cards, copyable verbatim prompt blocks, and SVG diagrams: dependency DAG, batch/critical-path timeline, file-ownership matrix, TDD loop).

Commands (run from `tools/docs-gen/`):

```bash
npm run build                      # all projects + plans
npm run build -- <project>         # one project (e.g. ballot-counter)
npm run build -- <project> <plan>  # one plan (e.g. ballot-counter 003)
npm run watch                      # rebuild affected project on plan-NNN.yaml save
```

## Three config layers (full schema in the README)

| File | Holds | Authored when |
|---|---|---|
| `projects/<group>/<name>/docs/plan-NNN.yaml` | The plan itself — single source of truth. Cycles (id/title/owner/`deps`/`status`/phases/session-prompt), `batches`, `critical-path`, `file-ownership`, runbook prose, overview. Validated against `schema/plan.schema.json`. | Plan authoring |
| `tools/docs-gen/projects.config.json` | Registry: per project `{name, docsRoot, outDir, site, plans[{id}]}`. A plan entry is just its `id` (the generator derives `plan-<id>.yaml`). | New project or new plan onboarded |
| `tools/docs-gen/sites/<name>.site.json` | Project identity: `productName`, `accent`, `themeKey`, `landing{eyebrow,title,lede}`. | New project onboarded (once) |

The diagram graph data (cycle `deps`, `batches`, `critical-path`, `file-ownership`) lives inside the YAML — there is no separate meta file. The batch table, DAG, file-ownership matrix, and progress dashboard are **derived views** over `cycles[]` + `batches[]`; never keep a second copy of a cycle's id/owner/status/deps elsewhere in the YAML.

## Plan-author owns the YAML

The plan author writes the whole `plan-NNN.yaml`, including the graph fields (`deps`, `batches`, `critical-path`, `file-ownership`) — they already hold that knowledge from designing the cycles and runbook. A plan is not "done" until its YAML validates (`npm run validate`) and `npm run build -- <project> <plan>` is green. Graph data not stated verbatim in the plan prose is **inferred** by the author; note inferred edges (e.g. in a comment or the report) so reviewers can check them.

## Onboarding checklist (new plan / new project)

1. Author `projects/<group>/<name>/docs/plan-NNN.yaml` per the schema (cycles + graph fields + runbook + overview).
2. Add `{ "id": "NNN" }` to the project's `plans[]` in `projects.config.json` (create the project entry if new).
3. If a new project: create `tools/docs-gen/sites/<name>.site.json` with a **distinct** `accent` + `themeKey` (theme persistence is per-project; do not reuse another project's key).
4. `npm run validate` then `npm run build -- <project>` → confirm valid, exit 0, no external network refs, diagrams render.

## When to regenerate

- **End of every cycle** — after the cycle's `status:` is updated in `plan-NNN.yaml` (a [cycle-orchestration.md §Definition of done](cycle-orchestration.md#definition-of-done) step), run `npm run build -- <project>` so the status dashboard reflects reality.
- **Any edit to a `plan-NNN.yaml`** — regenerate the affected project before inviting COMMIT (or keep `npm run watch` running during the session).
- The generated `html/` is committed only if the project tracks it. If `docs/html/` is git-ignored, regeneration is a local convenience and nothing is staged; if tracked, stage the regenerated HTML in the same commit as the source change so the two never drift.

## Boundaries

- Output (`html/`) is generated — hand-edits get overwritten on the next build. Fix the source.
- The generator must stay project-agnostic: project identity lives in `site.json`, never hardcoded in `tools/docs-gen/` source.
- Tone boundary: docs prose is normal, not caveman (per [commit.md](commit.md) boundary on docs).
