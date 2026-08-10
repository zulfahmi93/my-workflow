---
name: index
description: Top catalog of the My Workflow wiki — projects, concepts, people, glossary.
metadata:
  type: index
---

# My Workflow — Wiki

Compiled synthesis layer (Karpathy LLM-wiki style). agent-maintained. Reads project sources, writes business + plan synthesis, links via `[[wikilinks]]`.

**Authoritative raw sources:** `projects/<group>/<name>/docs/` per project (`<group>` = `personal` or `rintis`). This wiki is a read-cache; never the source of truth. Every page cites its source.

## Projects

Grouped by owner — `projects/personal/` and `projects/rintis/`.

### Personal

- [[ballot-counter]] — handwritten ballot scanning platform (UNDI)
- [[ai-receipt-maker]] — multi-output receipt renderer (Plan 001 landed; no active milestone)
- [[susun-jadual]] — AI-assisted school timetable generator (plan-001 v2 post-roundtable 2026-05-19; 25 cycles + Phase 0/0.5/7; zero cycles shipped; replaces RM2,800–3,400 single-PC incumbents)
  - [[susun-jadual-roundtable-2026-05]] — 3-Opus roundtable synthesis behind plan-001 v2

### Company

- [[tunas-lite]] — WhatsApp clock-in demo (Phase 5 in progress — Loom recording pending)
- [[rintis-landing]] — _legacy_ Berdua.AI (née Rintis Tech) marketing landing on `rintis.tech` (live on dev; superseded by `landing-website/` post 2026-06-25 rebrand)
- [[isc-workflow-web]] — Next.js port of the iSarawak Care iSC Workflow government portal (plan-001 bootstrap complete; all 8 cycles done; 1.1–1.4 committed, 1.5–1.8 pending commit)

## Concepts

- [[group-eligibility]] — candidate/category eligibility model (ballot-counter)
- [[clock-in-flow]] — WhatsApp → face-match → geofence → DB flow (tunas-lite)
- [[skia-tri-output-rendering]] — one render, three outputs via canvas-backend swap (ai-receipt-maker)
- [[design-system-pivot]] — token-locked editorial system + 2026-05-17 Mistral-sunset → forest-green+lime pivot (legacy rintis-landing; superseded by Berdua.AI design system)
- [[timetable-csp]] — timetable scheduling as a Constraint Satisfaction Problem; OR-Tools CP-SAT engine + independent verifier (susun-jadual)

## People

_(empty — populate when stakeholders / customers / partners surface in conversation)_

## Glossary

_(empty — populate when domain terms repeat across projects or pages)_

## Operational rules (not in wiki)

See `.agents/rules/`:

- [`tdd.md`](../.agents/rules/tdd.md) — RED → GREEN → REVIEW → REFACTOR → COMMIT cycle
- [`commit.md`](../.agents/rules/commit.md) — commit policy + Conventional Commits prefixes
- [`cycle-orchestration.md`](../.agents/rules/cycle-orchestration.md) — architecture gate, session protocol, reviewer separation

## Maintenance

**Ingest** — read a changed source doc, update affected concept/project pages, append an entry to [`log.md`](log.md). Trigger on: cycle complete, ADR added, plan revised, stakeholder fact landed.

**Lint** — weekly sweep for stale `[[refs]]`, orphan pages, contradictions across concepts, project cards out of sync with the per-cycle `status:` field in the project's `plan-NNN.yaml`.

**Schema** — see `/AGENTS.md` §"Wiki schema" for page templates + conventions.
