# Rintis AI — Monorepo

Centralized repo for all Rintis AI projects. Each project under `projects/<name>/` is autonomous (own stack, own plan, own `CLAUDE.md`). This root file is the **meta layer**: repo layout, where to load further context, wiki schema (Karpathy-style LLM wiki).

## Layout

```
/projects/                # autonomous projects — each has own CLAUDE.md
  ballot-counter/         # handwritten ballot scanning (UNDI)
  tunas-lite/             # WhatsApp clock-in demo
  ai-receipt-maker/       # receipt PDF generator (.NET)
  baja-dunia/             # marketing site (PRD-driven, no TDD scaffold)
/wiki/                    # Karpathy-style LLM wiki — compiled synthesis layer
  index.md                # top catalog
  log.md                  # ingest changelog
  projects/<name>.md      # per-project business + plan summary card
  concepts/<topic>.md     # cross-cutting business / domain concepts
  people/<name>.md        # stakeholders (populate as they surface)
  glossary.md             # repeated domain terms
/.claude/
  agents/                 # shared subagents (all projects)
  skills/                 # shared skills (/tdd etc)
  rules/                  # shared operational rules
    lifecycle.md          # 7-phase product lifecycle + agent operating system + Research/Commercial standards + agent file schema
    tdd.md                # TDD cycle phases + generic test harness
    commit.md             # commit policy + Conventional Commits prefixes
    cycle-orchestration.md  # full cycle manual (architect gate, reviewer separation, subagent skeleton, hallucination guard, cycle notes, session protocol)
    review-checklist.md   # REVIEW phase categories the code-reviewer evaluates against
    docs-site.md          # plan-triad → HTML generator: when/how to regenerate, onboarding checklist
/tools/
  docs-gen/               # config-driven static-docs generator (plan/progress/batches MD → offline html/ site per project)
/docs/
  templates/              # canonical reusable artifacts (PRD, ADR, decision matrices, bet canvas, GTM, model card) — agents point here
/secrets/                 # git-ignored creds
```

## Context loading

Claude auto-loads BOTH this file and the project's `projects/<name>/CLAUDE.md` when working anywhere in that project's subtree. Split of responsibility:

| File | Holds |
|---|---|
| `/CLAUDE.md` (this) | Repo layout, wiki schema, meta orientation |
| `projects/<name>/CLAUDE.md` | Project-specific data rules, local-dev quirks, plan refs |
| `.claude/rules/*.md` | Shared operational rules — **not auto-loaded**; read on demand |
| `/wiki/**` | Business + plan synthesis — **not auto-loaded**; read on demand |

For "how do we work" questions (TDD, commit, cycle orchestration) → read `.claude/rules/`.

The planning docs render to a browsable HTML site via the repo-root [`tools/docs-gen/`](tools/docs-gen/) generator. The Markdown triad stays the source of truth; `html/` is generated output. When/how to regenerate + the new-plan onboarding checklist → [`.claude/rules/docs-site.md`](.claude/rules/docs-site.md).

The `.claude/agents/` are one coordinated operating system, not isolated prompts. The shared frame — the 7-phase product lifecycle, per-phase ownership map, the binding Mandatory Research Standard and Commercial Viability Standard, and the agent-file schema — lives in [`.claude/rules/lifecycle.md`](.claude/rules/lifecycle.md). Each agent references it rather than restating it; canonical artifacts they fill in live in `/docs/templates/`. Change the lifecycle once in `lifecycle.md`, not across every agent.

For "what is this project / what's the plan / what's the domain concept" → read `/wiki/`.

For authoritative project content (plans, cycle notes, research) → read `projects/<name>/docs/`. The wiki is a synthesis cache, not the source of truth.

## Wiki (Karpathy LLM-wiki style)

`projects/<name>/docs/` = raw layer (authoritative, mutable). `/wiki/` = compiled synthesis (Claude-maintained read-cache, never source of truth). The wiki holds **business matters + plans**. Operational rules (how-we-work) live in `.claude/rules/`, not in the wiki.

Schema, file conventions, frontmatter spec, page templates, ingest triggers, and lint policy → [`wiki/SCHEMA.md`](wiki/SCHEMA.md). Loaded on-demand when ingesting / linting; not needed for daily project work.

## Hard rules

- Wiki contains business + plans only. **Never operational rules** — those live in `.claude/rules/`.
- Wiki is synthesis, never authoritative. Always cite the raw source.
- Don't auto-commit. Explicit "commit" only. See `.claude/rules/commit.md`.
- Caveman mode is active for this repo via session hook — terse chat, normal code/commits/docs.
- When entering a project subtree, the project's own `CLAUDE.md` is authoritative on project-specific quirks (data fixtures, ports, legacy code, gitignored paths).
