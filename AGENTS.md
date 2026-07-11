# My Workflow — Monorepo

Centralized repo for personal and company projects. Each project under `projects/<group>/<name>/` (`<group>` = `personal` or `rintis`) is autonomous (own stack, own plan, own local agent guide). This root file is the **meta layer**: repo layout, where to load further context, and the wiki schema.

> Company brand: **Berdua.AI** (legal entity: **Berdua Sdn. Bhd.**). The `projects/rintis/` group dir is the legacy folder name — kept for path stability across plans, cycle notes, and wiki refs.

## Layout

```
/projects/                # autonomous nested repositories with local guidance
  personal/               # personal projects
    ai-receipt-maker/     # receipt PDF generator (.NET)
    ballot-counter/       # handwritten ballot scanning (UNDI)
    duitnow-demo/         # DuitNow payments app (Flutter)
    susun-jadual/         # AI-assisted school-timetable generator (CP-SAT)
    zulfahmi-portfolio/   # personal portfolio site (zulfahmi.dev)
  rintis/                 # company projects (Berdua.AI; folder name legacy)
    baja-dunia/           # marketing site (PRD-driven, no TDD scaffold)
    rintis-landing/       # legacy landing site (historical; superseded by landing-website/)
    landing-website/      # Berdua.AI marketing site (new; design + content in progress)
    tunas-lite/           # WhatsApp clock-in demo
/wiki/                    # Karpathy-style LLM wiki — compiled synthesis layer
  index.md                # top catalog
  log.md                  # ingest changelog
  projects/<name>.md      # per-project business + plan summary card
  concepts/<topic>.md     # cross-cutting business / domain concepts
  people/<name>.md        # stakeholders (populate as they surface)
  glossary.md             # repeated domain terms
/.agents/                 # agent-agnostic canonical configuration
  roles/                  # shared specialist role definitions
  skills/                 # portable Agent Skills
  workflows/              # vendor-neutral orchestration specifications
  scripts/                # portable enforcement and validation commands
  rules/                  # shared operational rules
    lifecycle.md          # 7-phase product lifecycle + agent operating system + Research/Commercial standards + model tier map + agent file schema
    tdd.md                # TDD cycle phases + generic test harness
    commit.md             # commit policy + Conventional Commits prefixes
    cycle-orchestration.md  # full cycle manual (architect gate, reviewer separation, subagent skeleton, hallucination guard, cycle notes, session + autonomous-run protocols)
    review-checklist.md   # REVIEW phase categories the code-reviewer evaluates against
    docs-site.md          # plan-NNN.yaml → HTML generator: when/how to regenerate, onboarding checklist
/.claude/                 # Claude Code compatibility adapter only
  agents/                 # thin discovery wrappers for .agents/roles/
  skills/                 # thin discovery wrappers for .agents/skills/
  workflows/              # Claude Workflow DSL implementations of neutral specs
  hooks/                  # Claude hook-protocol wrappers around .agents/scripts/
  settings.json           # Claude-specific models, plugins, effort, and hook wiring
/.codex/                  # Codex compatibility adapter only
  agents/                 # generated custom-agent TOML adapters for .agents/roles/
  hooks/                  # Codex hook-protocol wrappers around .agents/scripts/
  hooks.json              # Codex hook wiring
  config.toml             # repo-local Codex agent limits
/tools/
  docs-gen/               # config-driven static-docs generator (single-source plan-NNN.yaml → offline html/ site per project)
/docs/
  templates/              # canonical reusable artifacts (PRD, ADR, decision matrices, bet canvas, GTM, model card) — agents point here
/secrets/                 # git-ignored creds
```

## Context loading

Coding agents load this root `AGENTS.md`. When operating inside a nested project, also follow the nearest project-local guide. Some nested repositories still use legacy provider-specific guides; migrating them is intentionally out of scope for the root configuration.

| File | Holds |
|---|---|
| `/AGENTS.md` (this) | Repo layout, wiki schema, meta orientation |
| Nearest project-local guide | Project-specific data rules, local-dev quirks, plan refs |
| `.agents/rules/*.md` | Shared operational rules — read on demand |
| `/wiki/**` | Business + plan synthesis — **not auto-loaded**; read on demand |

For "how do we work" questions (TDD, commit, cycle orchestration) → read `.agents/rules/`.

The planning docs render to a browsable HTML site via the repo-root [`tools/docs-gen/`](tools/docs-gen/) generator. Each plan's single-source `plan-NNN.yaml` stays the source of truth; `html/` is generated output. When/how to regenerate + the new-plan onboarding checklist → [`.agents/rules/docs-site.md`](.agents/rules/docs-site.md).

The `.agents/roles/` are one coordinated operating system, not isolated prompts. The shared frame — the 7-phase product lifecycle, per-phase ownership map, the binding Mandatory Research Standard and Commercial Viability Standard, and the role-file schema — lives in [`.agents/rules/lifecycle.md`](.agents/rules/lifecycle.md). Each role references it rather than restating it; canonical artifacts they fill in live in `/docs/templates/`. Change the lifecycle once in `lifecycle.md`, not across every role.

For "what is this project / what's the plan / what's the domain concept" → read `/wiki/`.

For authoritative project content (plans, cycle notes, research) → read `projects/<group>/<name>/docs/`. The wiki is a synthesis cache, not the source of truth.

## Wiki (Karpathy LLM-wiki style)

`projects/<group>/<name>/docs/` = raw layer (authoritative, mutable). `/wiki/` = compiled synthesis (agent-maintained read-cache, never source of truth). The wiki holds **business matters + plans**. Operational rules live in `.agents/rules/`, not in the wiki.

Schema, file conventions, frontmatter spec, page templates, ingest triggers, and lint policy → [`wiki/SCHEMA.md`](wiki/SCHEMA.md). Loaded on-demand when ingesting / linting; not needed for daily project work.

## Hard rules

- Wiki contains business + plans only. **Never operational rules** — those live in `.agents/rules/`.
- Wiki is synthesis, never authoritative. Always cite the raw source.
- Don't auto-commit. Explicit "commit" only. See `.agents/rules/commit.md`.
- Caveman mode may be enabled by a provider adapter — terse chat, normal code/commits/docs.
- When entering a project subtree, its nearest local guide is authoritative on project-specific quirks. Prefer `AGENTS.md`; honor a legacy `CLAUDE.md` when that is the only local guide.
