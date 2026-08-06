# docs-gen — shared build-plan docs generator

A repo-root, **config-driven**, **YAML-only** static-HTML generator that turns each plan's
single source file `plan-NNN.yaml` into a polished, fully-offline documentation site under
that project's `docs/html/`.

It serves **multiple projects** from one tool. Project identity (brand, accent, theme,
landing copy) lives in per-project site configs; everything about a plan — cycles, scope,
phases (with verbatim code), session prompts, progress, the diagram graph, and runbook prose
— lives in that plan's one `plan-NNN.yaml`, validated against `schema/plan.schema.json`.

> The legacy MD-triad source format (`plan-NNN.md` + progress + `parallel-batches-NNN.md` +
> `plan-NNN.meta.json`) and its parsers were **removed**. The generator now consumes
> `plan-NNN.yaml` only; a missing YAML is a hard error.

This tool is the **source of truth** for the docs sites. Do not hand-edit any
`projects/<name>/docs/html/**` — edit `plan-NNN.yaml` (or the site config), then rebuild.

```
tools/docs-gen/                      ← THIS TOOL (repo-root, self-contained Node project)
  generate.mjs                         entry point (repo root resolved relatively)
  projects.config.json                 the project registry (what to build)
  schema/
    plan.schema.json                   JSON Schema (draft 2020-12) the plan YAML is validated against
    cycle-note.schema.json             JSON Schema for execution-only cycle notes (docs/cycles/<X.Y>.yaml)
  sites/
    ballot-counter.site.json           per-project identity (brand/accent/theme/landing)
    susun-jadual.site.json
  lib/
    load-yaml-source.mjs               plan-NNN.yaml → internal model (the ONLY source loader)
    validate-source.mjs                ajv schema + referential-integrity validation
    render-svg.mjs                     DAG, batch timeline, file-ownership matrix from the plan YAML graph fields; static TDD loop
    templates.mjs                      page templates (shell, cycle cards, code blocks, tables, badges)
  scripts/
    validate-cycle-note.mjs            standalone ajv gate for cycle notes (not part of the build)
  assets/style.css                     ← edit shared CSS HERE (copied into each project's html/assets/)
  assets/app.js                        ← edit shared JS HERE (theme key read from the DOM, project-agnostic)
  package.json + package-lock.json     deps: yaml, ajv, markdown-it, markdown-it-anchor, chokidar (committed lockfile)

projects/<name>/docs/                 ← PER-PROJECT SOURCES (authoritative; never mutated by the tool)
  plan-NNN.yaml                          one file per plan — the single source of truth
  html/                                ← GENERATED OUTPUT (per project; self-contained + portable)
    index.html                           project landing: lists that project's plans
    assets/{style.css,app.js}            its own copy of the shared assets
    NNN/{index.html, plan.html, [batches.html]}
```

Each project's `html/` is fully self-contained (its own `assets/` copy), so it can be
served or zipped per project without the others.

## Commands

Run from `tools/docs-gen/`:

```bash
npm ci                          # install from the committed lockfile
npm run build                   # ALL projects, ALL plans
npm run build -- susun-jadual   # one project (its landing reflects all its plans)
npm run build -- ballot-counter 003   # one plan's pages (+ that project's landing)
npm run watch                   # watch every configured docsRoot; rebuild only the touched project/plan
```

Underlying CLI: `node generate.mjs [--watch] [project] [plan]`. Repo root is resolved
relative to this file (`tools/docs-gen → ../..`); no absolute home path is hardcoded.

## Config 1 — the project registry: `projects.config.json`

The list the generator iterates. Each plan entry is just its `id`; the generator derives
`plan-<id>.yaml` from the project's `docsRoot`. (Add `"yaml": "<file>"` only for a
non-default source filename.)

```jsonc
{
  "projects": [
    {
      "name": "ballot-counter",
      "docsRoot": "projects/personal/ballot-counter/docs",    // relative to repo root
      "outDir": "projects/personal/ballot-counter/docs/html",  // relative to repo root
      "site": "ballot-counter.site.json",             // file under tools/docs-gen/sites/
      "plans": [ { "id": "002" }, { "id": "003" }, { "id": "004" }, { "id": "005" } ]
    }
  ]
}
```

## Config 2 — per-project identity: `sites/<name>.site.json`

All project-identity lives here (no brand string is hardcoded in the generator):

```jsonc
{
  "productName": "UNDI",                 // brand in header, footer, page titles
  "accent": "#c0392b",                   // --accent; injected inline <head> per page
  "themeKey": "undi-docs-theme",         // localStorage key (per project → themes are isolated)
  "footerTagline": "Handwritten ballot scanning · zulfahmi.dev",  // optional
  "landing": {                           // the project landing hero
    "eyebrow": "UNDI · build documentation",
    "title": "Build plans for UNDI ballot counting",
    "lede": "…"
  }
}
```

- **Accent** is injected as an inline `:root{--accent:…}` in each generated page's
  `<head>`; the shared `style.css` only carries a fallback default, so it stays static
  while each project themes itself.
- **Theme key** is written to `<html data-theme-key="…">`; the shared `app.js` reads it
  from the DOM, so light/dark persistence is independent per project (ballot's toggle
  state never affects susun's).
- Page / landing **titles** come from `site.productName` + the plan's `meta.title`
  (preferred) or the plan's `# H1`.

### Diagram graph data (inside the YAML)

The diagrams are driven by fields in `plan-NNN.yaml`: the dependency DAG from each cycle's
`deps[]`; the batch timeline from `batches[]` + `critical-path[]`; the file-ownership matrix
from each cycle's `file-ownership.dirs[]`. The matrix maps each `dirs` entry to a stack
column by regex (`apps/web`→web, `apps/api`→api, `services/solver`→solver, `services/ocr|import`
or a stray `.py`→ocr/py, `supabase`→supabase, `infra/|scripts/|Dockerfile|…`→infra). Adjust
`MATRIX_COLS` in `lib/templates.mjs` if a project introduces a new stack. Omit the graph
fields and the corresponding diagram is skipped gracefully (the static TDD-loop always renders).

### Adding a new project / plan

1. Author `projects/<name>/docs/plan-NNN.yaml` (schema below).
2. Add a `sites/<name>.site.json` (brand/accent/theme/landing).
3. Add the project (+ its plans, each just `{ "id": "NNN" }`) to `projects.config.json`.
4. `npm run build`.

No generator code changes are needed for a project that follows the schema.

## Dependencies (repo dependency discipline)

- **yaml** (eemeli/yaml, ISC) — parses the single-source `plan-NNN.yaml`. Chosen over JSON
  for readable literal block scalars (`|`) on multi-line prompts / code / prose; its lossless
  round-trip is what lets verbatim fields stay byte-exact.
- **ajv** (MIT) — JSON Schema (draft 2020-12) validator for the YAML source. A hand-edited
  single source needs a declarative safety net: ajv catches typo'd / unknown keys
  (`additionalProperties:false`), bad enums, and type errors from a misindented block scalar
  *before* render, so the build fails loudly instead of mis-rendering. Uses `ajv/dist/2020`
  for the 2020-12 meta-schema. (Cross-reference integrity is checked in code — see below.)
- **markdown-it** (MIT) — renders the YAML's markdown **prose** fields (`overview.*`, cycle
  `scope`, phase `body`, `runbook.*`, table cells) → HTML. `linkify` is **off** and relative
  links are neutralised to inert `<span class="ref">` so the offline site has zero
  broken/network links. **Verbatim fields bypass the renderer** — phase `code[].src`,
  `session.prompt`, and worktree bash are emitted byte-for-byte (prompts get pasted into fresh
  agent sessions, so fidelity matters and is asserted on review).
- **markdown-it-anchor** (MIT) — stable heading slugs so in-page anchors + the TOC line up.
- **chokidar** (MIT, dev-only) — cross-platform file watcher for `--watch`. v4 dropped glob
  support, so we watch each `docsRoot` at depth 0 and filter to `*.yaml`, mapping a changed
  file back to the single affected project + plan.

Everything else (SVG diagrams, code-token styling, theming) is hand-rolled and
dependency-free, per the offline / no-CDN constraint.

## The single-YAML source

Each plan is one **kebab-case YAML file** `plan-NNN.yaml` where the **cycle is the hub**:
each cycle's id/title/primary/deps/status/file-ownership/phases (with verbatim code) and its
session prompt live **once** under that cycle. The batch-summary table, dependency DAG, batch
timeline, file-ownership matrix, and progress table are **views** the generator derives from
`cycles[]` + `batches[]` — never re-listed. Runbook prose that is not cycle-scoped lives under
`runbook`. `lib/load-yaml-source.mjs` loads + shapes it into the internal model; the build
fails with a clear error if a plan's YAML is missing.

Live status: all plans are YAML — ballot-counter 002/003/004/005 + susun-jadual 001.

### Validation (safety net for the hand-edited YAML)

```bash
npm run validate                 # validate every YAML-sourced plan; no build
node generate.mjs --validate susun-jadual   # scope to a project
```

Validation runs automatically inside every YAML build (a failure aborts the build,
non-zero) and is two-layer:

- **JSON Schema** (`schema/plan.schema.json`, draft 2020-12, via **ajv**) — required fields,
  enums (`status` ∈ idle|wip|ok; `arch-review.state` ∈ required|none|deferred, and when
  `required` → `tier` ∈ top|mid; phase `model` ∈ top|mid — legacy `opus`/`sonnet` accepted
  for both and normalized to those two tiers while loading. `cheap`/`haiku` were accepted
  here until the tier they named was retired from
  [lifecycle.md §Model capability tiers](../../.agents/rules/lifecycle.md#model-capability-tiers);
  both are now rejected. A declared tier is validated but never published — the site renders
  the tier the runtime actually binds, see `PHASE_TIER` in `lib/load-yaml-source.mjs`), types, and
  `additionalProperties:false` everywhere so a typo'd / unknown key (or a misindented block
  scalar that lands as the wrong type) fails loudly.
- **Referential integrity** (in `lib/validate-source.mjs`, which ajv can't express) — every
  `deps[]`, `critical-path[]`, and `batches[].cycles[]` entry must reference an existing
  cycle `id`; a dangling ref errors with the offending id.

Failure prints the JSON-path + a human message per violation, e.g.:

```
Schema/integrity validation FAILED for ballot-counter/plan-002.yaml (1 error):
  ✗ /cycles/2 (002.3) /deps/0 → unknown cycle id "002.99" (not in cycles[])
```

### Cycle notes (execution-only)

Per-cycle execution records live at `projects/<group>/<name>/docs/cycles/<X.Y>.yaml`, validated against
`schema/cycle-note.schema.json`. They are **not part of this build** — `generate.mjs` never reads
them and they are **not rendered into the HTML site** (the plan YAML's cycle `status:` already
drives the progress dashboard). They are read by the TDD orchestrator/reviewer and reviewed by a
human at commit-time via the diff.

```bash
npm run validate-cycle-note                                                    # all grouped project cycle notes
npm run validate-cycle-note -- projects/<group>/<name>/docs/cycles/<X.Y>.yaml  # one file (path relative to repo root)
```

Same ajv-2020 net as the plan schema (required fields, enums, `additionalProperties:false`), plus:
a `security-tier: true` note must carry a `threat-model`, and the filename `<X.Y>` must match the
`cycle:` field. Exits non-zero on violation so it can gate a commit. Convention + field reference:
`.agents/rules/cycle-orchestration.md` §Cycle notes format.

### Kebab-case YAML schema (per plan)

All multi-word keys are kebab-case. `red/green/review/refactor` phase keys and `code[].lang/
.src` stay single-word.

```
id, project, title, one-liner,
overview { context, stack, tdd-cycle-format, plan-003-note,      # named extras +
           extra-sections[] { id?, heading, body } },           # any plan-specific prose (Core concept, Phase intros, Alpha exit) — all render after Context
links { … }, critical-path[], wall-time-saved,
batches[] { id, cycles[], wall-time, notes, heading, intro },   # one `notes` (rich) drives timeline + summary table
cycles[] {
  id, title, primary[], deps[], batch,
  arch-review { state, tier?, reviewer?, reason?, deferred-to? },
  security-tier, no-tdd?, closes, status, shipped, notes, scope,
  file-ownership { dirs[], new-files[] },
  phases { red|green|review|refactor|security-review { model, agent, meta-raw?, body?, code[{ lang, src }] } },
  session { title, before, prompt, after }                      # prompt is verbatim; mandatory-reads cite plan-002.yaml
},
runbook { h1, final-state-heading, intro, how-to-use, common-contract, worktree-convention,
          merge-protocol, batch-summary-note, file-ownership-notes, inter-batch-verification,
          stop-conditions, final-state },
open-questions { headers[], placeholder, rows[] },
cycle-followups { headers[], placeholder, rows[] }
```

The status table/dashboard renders the cycle `title` directly (no separate progress
description). Each cycle's `session.prompt` is byte-verbatim except its "Mandatory reads"
lines, which now cite `docs/plan-002.yaml` as the single source.

## Output guarantees

- Fully offline: no CDN, no web fonts, no JS highlighter. The only `http(s)://` literals
  in the output sit inside verbatim `<pre>`/`<code>` (source content).
- Accessible: semantic HTML, ARIA on icon-only controls, keyboard nav, visible focus,
  AA contrast; light + dark via a **per-project** `localStorage` key (no-flash inline head
  script reads the key from `data-theme-key`).
- Responsive: sticky TOC that collapses on mobile; tables scroll; diagrams scale.
- Diagrams themed via CSS vars / `currentColor` so they read in both modes; the accent is
  a per-project override.
- Each project's site is self-contained (own `assets/` copy) and portable.
