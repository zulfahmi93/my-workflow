---
name: isc-workflow-web
description: Next.js port of the iSarawak Care iSC Workflow government portal. Plan-001 (bootstrap) complete — all 8 cycles done (1.1–1.4 committed; 1.5–1.8 pending commit).
metadata:
  type: project
  status: plan-001-complete
  last_ingested: 2026-05-29
---

# iSC Workflow Web

**Status:** Plan-001 (bootstrap) complete as of 2026-05-29. All 8 cycles done: 1.1–1.4 committed; 1.5–1.8 approved and pending the B02/B03/B04/B05 commit batch. No security-tier cycles (auth is plan-002).

## What

The Next.js App Router port of the **iSarawak Care iSC Workflow** portal — a multi-role Sarawak government workflow + form-builder platform (admin CMS + public applicant portal) migrating off Flutter (`app_workflow`) onto a typed, server-rendered web stack. The backend stays as-is on SOCOE; this repo is the web frontend only. Plan-001 builds nothing user-facing — it lays the rails (scaffold, typed API client, providers/state, test harness, i18n pipeline, project docs) that plans 002–006 run on.

## Why

The Flutter app is being migrated to web for reach and maintainability against an existing, unchanged government backend (141-operation OpenAPI contract on SOCOE). The migration carries forward behaviour and the three locales (EN/MS/ZH, catalogs from the Flutter ARB), but **not** the realtime/offline machinery (no WebSockets, FCM push, or offline sync). Every stack pick is defended against the repo Mandatory Research Standard (8 axes, ≥2 alternatives, named trade-off + reversibility) in the Cycle-1.3 research report; the picks are locked in ADR-0001.

Key constraints: SarawakID OAuth with a **365-day non-refresh Bearer token** (auth is plan-002, via Auth.js v5); the OpenAPI spec has **no `servers:` block** so the client `baseUrl` is set at runtime per environment (dev `iscworkflow.socoe.co` / prod `isc-initiative.socoe.co`); the generated API client must tolerate mostly-untyped non-2xx bodies via a hand-written validation-error narrowing guard.

Notable plan-001 implementation notes (from cycle notes):

- **proxy.ts not middleware.ts** — Next.js 16.2.6 uses `proxy.ts` as the canonical middleware filename; the plan's `middleware.ts` reference was corrected in Cycle 1.5 per the architect's corrective ruling.
- **Plain MSW handlers** — Cycle 1.6 determined that `openapi-msw` cannot be wired without a unified `paths` map (which `@hey-api/openapi-ts` does not emit). Plain `msw/node` `http.get`/`http.post` handlers with response bodies typed against the generated per-operation types provide identical zero-network guarantees.
- **3-locale catalogs** — Cycle 1.7 emitted `apps/web/messages/{en,ms,zh}.json` from the Flutter ARB source. EN is the 1052-key canonical superset; MS (979 ARB keys) and ZH (973 ARB keys) are back-filled from EN so all three catalogs are render-complete and key-identical (1052 keys each, zero orphans).
- **Corrective round on Cycle 1.5** — a post-APPROVED sanity check surfaced four defects (D1–D4: async layout, nested `<html>`, missing `[locale]/page`, absent `ms`/`zh` catalog during prerender). All fixed in an architect-ruled corrective round and independently re-reviewed by a fresh Code Reviewer before commit.

## Core domain concept

_(none yet)_ — no `wiki/concepts/<topic>.md` exists for this project. Candidate concepts to extract as plans land: the form-builder / workflow-levels model, and the OpenAPI-codegen + typed-error-envelope strategy (ADR-0002, Cycle 1.4).

## Stack

Locked in `projects/rintis/isc-workflow-web/docs/adr/0001-stack-adoption.md`; defended in `docs/research-report.md`. Plan-001 stands up the foundation; later rows arrive in their own plans.

| Layer | Tech | Lands in |
|---|---|---|
| Framework | Next.js 16.2.x App Router + TypeScript (strict) | Cycle 1.1 (shipped `03eede3`) |
| Styling | Tailwind CSS v4 (CSS-first) + shadcn/ui | Cycle 1.1 (shipped `03eede3`) |
| API client | `@hey-api/openapi-ts` (typescript + sdk + client-fetch + TanStack Query plugins) → `packages/api-client` | Cycle 1.4 |
| Server state | TanStack Query v5 | Cycle 1.5 |
| App/session state | Zustand v5 | Cycle 1.5 |
| i18n | next-intl v4 (EN/MS/ZH; 1052-key catalogs from Flutter ARB) | Cycle 1.5 + 1.7 |
| Testing | Vitest 4 + Playwright 1.60 + MSW 2 (plain `http` handlers) | Cycle 1.6 |
| Auth | Auth.js v5 (SarawakID OAuth, server-side, `httpOnly` cookie) | plan-002 |

## Layout

```
projects/rintis/isc-workflow-web/
├── apps/web/                Next.js 16 App Router app (TS strict, Tailwind v4, shadcn/ui)
├── packages/api-client/     generated typed SDK from raw/openapi.yaml (Cycle 1.4)
├── scripts/                 codegen.mjs, arb-to-json.mjs
├── raw/openapi.yaml         committed read-only SOCOE contract — never hand-edit
├── docs/                    plan-001.yaml (single source), research-report.md, adr/, cycles/, html/ (generated)
├── CLAUDE.md                project-specific operational rules
└── README.md
```

Local dev: `cd apps/web && npm run dev` → http://localhost:3000. Codegen via `npm run codegen` from `apps/web/`; ARB catalogs via `node scripts/arb-to-json.mjs` from project root (one-shot, already committed). The Flutter reference app at `/Users/zulfahmi/Desktop/ukuya/03-app-isarawak-care/app_workflow/` is read-only, outside this repo, never vendored.

## Plan status

**Plan:** `projects/rintis/isc-workflow-web/docs/plan-001.yaml` (single-source YAML). Bootstrap plan — 8 cycles across 5 parallel batches (critical path 1.1 → 1.4 → 1.5 → 1.6/1.7 → 1.8, ~35% wall-time saved). Status below is a derived view of each cycle's `status:` field in the plan YAML.

| Cycle | Description | Status |
|---|---|---|
| 1.1 | Repo scaffold — Next.js App Router + TS strict + Tailwind v4 + shadcn/ui | ✅ Shipped (`03eede3`) |
| 1.2 | Project docs — CLAUDE.md + README + wiki card | ✅ Done (pending commit) |
| 1.3 | Mandatory research report + ADR-0001 (stack adoption) | ✅ Done (pending commit) |
| 1.4 | OpenAPI codegen pipeline — `@hey-api/openapi-ts` → `packages/api-client` + ADR-0002 | ✅ Done (pending commit) |
| 1.5 | App providers + state skeleton — TanStack Query + Zustand + next-intl + root layout + ADR-0003 | ✅ Done (pending commit) |
| 1.6 | Test harness — Vitest + Playwright + MSW + CI | ✅ Done (pending commit) |
| 1.7 | ARB → `messages/*.json` converter + key-parity | ✅ Done (pending commit) |
| 1.8 | plan-001 wrap — docs-gen build green + validators + wiki ingest | ✅ Done (pending commit) |

Three cycles (1.2, 1.3, 1.8) are NO-TDD docs/verification cycles (no RED phase). Auth + app shell are plan-002.

## Authoritative sources

- Plan (single source of truth; per-cycle `status:` lives in the plan YAML): `projects/rintis/isc-workflow-web/docs/plan-001.yaml`
- Cycle notes: `projects/rintis/isc-workflow-web/docs/cycles/<X.Y>.yaml`
- Research: `projects/rintis/isc-workflow-web/docs/research-report.md` (Cycle 1.3)
- Decisions: `projects/rintis/isc-workflow-web/docs/adr/{0001,0002,0003}-*.md`
- API contract: `projects/rintis/isc-workflow-web/raw/openapi.yaml` (committed read-only SOCOE spec)
- Project operational rules: `projects/rintis/isc-workflow-web/CLAUDE.md`
- Flutter reference (read-only, outside repo, never vendored): `/Users/zulfahmi/Desktop/ukuya/03-app-isarawak-care/app_workflow/`
