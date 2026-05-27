---
name: ballot-counter
description: Handwritten ballot scanning platform (UNDI). Post-MVP plan-002 in progress.
metadata:
  type: project
  status: plan-002-in-progress
  last_ingested: 2026-05-16
---

# Ballot Counter (UNDI)

**Status:** Plan-002 in progress (post-MVP). 6 cycles, 0 shipped (as of 2026-05-16). Plan-001 (MVP) frozen and archived.

## What

Generic handwritten ballot scanning platform. Works for any handwritten voting form where votes come from a predefined roster. Replaces a legacy `review.py` CLI.

## Why

Hand-counting handwritten ballots is slow, error-prone, and doesn't scale. Children's-quality handwriting on Malay-language ballots is among the hardest OCR tasks: even 100B+ open-weight VLMs score 0.40–0.58 on handwriting-heavy benchmarks (May 2026), while Gemini 3.1 Flash-Lite reaches 0.60–0.64. Architecture follows the research recommendation: layout detector + Gemini OCR on cropped cells + roster-based classification + light human-in-the-loop correction.

See `projects/ballot-counter/docs/research-report.md` §1 for the full benchmark + cost analysis (≈ \$0.0001–\$0.0005 per cell — under RM5/month at typical volumes).

## Core domain concept

[[group-eligibility]] — free-text candidate group tags + per-category required group + per-election strict/permissive policy. No hardcoded gender.

## Stack (May 2026 LTS / latest stable)

| Layer | Tech |
|---|---|
| Frontend | Next.js 16.2 + Tailwind 4.2 + shadcn/ui v4 + TanStack Query v5 |
| Backend | .NET 10 LTS + EF Core 10 + Npgsql Minimal API |
| OCR | Python 3.13 + FastAPI 0.136.1 + Gemini 2.5 Flash-Lite (`gemini-3.1-flash-lite`) |
| Fuzzy match | FuzzySharp + Double Metaphone |
| DB / Auth / Storage | Supabase |
| Proxy / Hosting | Caddy + Hetzner CPX21 SG |

## Layout

```
projects/ballot-counter/
├── apps/web/              Next.js 16
├── apps/api/              .NET 10
├── services/ocr/          Python 3.13 FastAPI
├── docs/                  plan-{002..005}.yaml, research-report.md, cycles/, html/ (generated), archive/plan-001/
├── infra/                 docker-compose.yml, Caddyfile (later)
├── supabase/migrations/   schema
└── CLAUDE.md              project-specific operational rules
```

Local dev: `cd infra && docker compose up -d` → web:3000, api:5050 (host; container 5000 — macOS AirPlay squats 5000), ocr:8000.

## Plan-002 status

**Plan:** `projects/ballot-counter/docs/plan-002.yaml` (single-source YAML; plans 003–005 also filed as `plan-00N.yaml`). Six cycles, all post-MVP follow-ups + navigation glue plan-001 never specced.

| Cycle | Description | Status |
|---|---|---|
| 002.1 | Navigation + onboarding flow | ⬜ Not started |
| 002.2 | Ballot-cell bbox image overlay | ⬜ Not started |
| 002.3 | `mark_rosak` PATCH action | ⬜ Not started |
| 002.4 | xlsx → roster confirmation UI | ⬜ Not started |
| 002.5 | Supabase Storage bucket policy | ⬜ Not started |
| 002.6 | Phase 5 ops hardening sweep | ⬜ Not started |

002.1 ships first because without nav glue the rest lands in a UI users can't reach (`/elections` is a stub, `/elections/new` requires `?template_id=`, `/import` requires `?election_id=`).

## Authoritative sources

- Plans: `projects/ballot-counter/docs/plan-{002,003,004,005}.yaml` (single source of truth; per-cycle `status:` lives in each plan YAML — no separate progress tracker)
- Cycle notes: `projects/ballot-counter/docs/cycles/<X.Y>.yaml`
- Research: `projects/ballot-counter/docs/research-report.md`
- Plan-001 (frozen MVP): `projects/ballot-counter/docs/archive/plan-001/plan-001.md`
- Project operational rules: `projects/ballot-counter/CLAUDE.md`
