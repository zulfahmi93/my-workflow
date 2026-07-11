---
name: log
description: Ingest changelog. One row per wiki update event.
metadata:
  type: log
---

# Wiki ingest log

Append-only. Newest first. Format: `YYYY-MM-DD | <source(s)> | <wiki pages touched>`.

## 2026-05-29

| Date | Source | Pages touched |
|---|---|---|
| 2026-05-29 | `projects/rintis/isc-workflow-web/docs/plan-001.yaml` (Cycle 1.8 plan-001 closeout; all 8 cycles ok; 1.1 shipped `03eede3`, 1.2–1.8 pending commit; proxy.ts + plain-MSW harness + 3-locale catalogs noted) | `projects/isc-workflow-web.md` (status table + narrative reconciled to final reality), `index.md` (§Projects entry added) |
| 2026-05-29 | `projects/rintis/isc-workflow-web/{CLAUDE.md,README.md,docs/plan-001.yaml,raw/openapi.yaml}` (Cycle 1.2 project-docs bootstrap; 1.1 shipped `03eede3`) | `projects/isc-workflow-web.md` (created), `index.md` (§Projects link added) |

## 2026-05-19

| Date | Source | Pages touched |
|---|---|---|
| 2026-05-19 | `projects/personal/susun-jadual/docs/roundtable/{architect.md,pm.md,ux.md,joint-verdict.md}` + revised `docs/plan-001.md` + `docs/progress.md` (post-roundtable v2; 25 cycles + Phase 0/0.5/7) | `projects/susun-jadual-roundtable-2026-05.md` (created), `projects/susun-jadual.md` (cycle table refreshed + revision-history section) |
| 2026-05-19 | `projects/personal/susun-jadual/{CLAUDE.md,docs/plan-001.md,docs/progress.md,docs/research-report.md}` | `projects/susun-jadual.md` (created), `concepts/timetable-csp.md` (created), `index.md` (links added) |

## 2026-05-17

| Date | Source | Pages touched |
|---|---|---|
| 2026-05-17 | `projects/rintis/rintis-landing/{CLAUDE.md,DESIGN.md,AGENTS.md,README.md,package.json,docs/deploy.md,app/page.tsx,app/_components/}` | `projects/rintis-landing.md` (created), `concepts/design-system-pivot.md` (created), `index.md` (links added) |

## 2026-05-16

| Date | Source | Pages touched |
|---|---|---|
| 2026-05-16 | `projects/rintis/tunas-lite/{CLAUDE.md,docs/plan-001.md,docs/parallel-waves.md,docs/progress.md,TUNAS_Lite_Quotation.md}` | `projects/tunas-lite.md` (created), `concepts/clock-in-flow.md` (created), `index.md` (link added) |
| 2026-05-16 | `projects/personal/ai-receipt-maker/{CLAUDE.md,README.md,docs/PROGRESS.md,docs/adr/0001..0004}` | `projects/ai-receipt-maker.md` (created), `concepts/skia-tri-output-rendering.md` (created), `index.md` (link added) |
| 2026-05-16 | _pilot bootstrap — `projects/personal/ballot-counter/{CLAUDE.md,docs/plan-002.md,docs/progress.md,docs/research-report.md,docs/archive/plan-001/plan-001.md}`_ | `index.md` (created), `projects/ballot-counter.md` (created), `concepts/group-eligibility.md` (created) |
