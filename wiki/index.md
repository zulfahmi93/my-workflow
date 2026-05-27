---
name: index
description: Top catalog of the Rintis AI wiki — projects, concepts, people, glossary.
metadata:
  type: index
---

# Rintis AI — Wiki

Compiled synthesis layer (Karpathy LLM-wiki style). Claude-maintained. Reads project sources, writes business + plan synthesis, links via `[[wikilinks]]`.

**Authoritative raw sources:** `projects/<name>/docs/` per project. This wiki is a read-cache; never the source of truth. Every page cites its source.

## Projects

- [[ballot-counter]] — handwritten ballot scanning platform (UNDI)
- [[tunas-lite]] — WhatsApp clock-in demo (Phase 5 in progress — Loom recording pending)
- [[ai-receipt-maker]] — multi-output receipt renderer (Plan 001 landed; no active milestone)
- [[rintis-landing]] — Rintis Tech marketing landing on `rintis.tech` (live on dev; dark forest-green + lime editorial system post 2026-05-17 pivot)
- [[susun-jadual]] — AI-assisted school timetable generator (plan-001 v2 post-roundtable 2026-05-19; 25 cycles + Phase 0/0.5/7; zero cycles shipped; replaces RM2,800–3,400 single-PC incumbents)
  - [[susun-jadual-roundtable-2026-05]] — 3-Opus roundtable synthesis behind plan-001 v2
- _baja-dunia_ — pending ingest (Phase 2 architecture in flight; PRD locked)

## Concepts

- [[group-eligibility]] — candidate/category eligibility model (ballot-counter)
- [[clock-in-flow]] — WhatsApp → face-match → geofence → DB flow (tunas-lite)
- [[skia-tri-output-rendering]] — one render, three outputs via canvas-backend swap (ai-receipt-maker)
- [[design-system-pivot]] — token-locked editorial system + 2026-05-17 Mistral-sunset → forest-green+lime pivot (rintis-landing)
- [[timetable-csp]] — timetable scheduling as a Constraint Satisfaction Problem; OR-Tools CP-SAT engine + independent verifier (susun-jadual)

## People

_(empty — populate when stakeholders / customers / partners surface in conversation)_

## Glossary

_(empty — populate when domain terms repeat across projects or pages)_

## Operational rules (not in wiki)

See `.claude/rules/`:

- [`tdd.md`](../.claude/rules/tdd.md) — RED → GREEN → REVIEW → REFACTOR → COMMIT cycle
- [`commit.md`](../.claude/rules/commit.md) — commit policy + Conventional Commits prefixes
- [`cycle-orchestration.md`](../.claude/rules/cycle-orchestration.md) — architecture gate, session protocol, reviewer separation

## Maintenance

**Ingest** — read a changed source doc, update affected concept/project pages, append an entry to [`log.md`](log.md). Trigger on: cycle complete, ADR added, plan revised, stakeholder fact landed.

**Lint** — weekly sweep for stale `[[refs]]`, orphan pages, contradictions across concepts, project cards out of sync with the project's `docs/progress.md`.

**Schema** — see `/CLAUDE.md` §"Wiki schema" for page templates + conventions.
