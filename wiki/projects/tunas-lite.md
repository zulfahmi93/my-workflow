---
name: tunas-lite
description: 3-min Loom demo backing the TUNAS Lite partner quotation. WhatsApp clock-in → face-match → geofence → Postgres → dashboard.
metadata:
  type: project
  status: phase-5-in-progress
  last_ingested: 2026-05-16
---

# TUNAS Lite Demo

**Status:** Phases 0–4 ✅ shipped (2026-05-13 / 14). Phase 5 (E2E smoke + Loom recording) 🔄 in progress — services up, employee seeded, awaiting real WhatsApp send for full round-trip.

## What

3-min Loom demo proving the proposed TUNAS Lite stack works end-to-end: WhatsApp clock-in (employee sends selfie + location pin) → .NET orchestrator verifies HMAC, fetches selfie via Graph API, calls Python face-match over gRPC, checks GPS geofence, writes attendance row → Next.js dashboard renders the result.

## Why

Built to back the **TUNAS Lite partner quotation** (`projects/rintis/tunas-lite/TUNAS_Lite_Quotation.md` line 23). Demonstrates the exact proposed stack works credibly before the partner signs — TUNAS reviewers can audit stack-honesty (no swapping FastAPI HTTP for the gRPC promise; no fudging the InsightFace claim with cloud face APIs).

**Demo NOT product.** Single test employee, single test worksite. Multi-tenant + RLS, LHDN MyInvois, OCR pipelines (receipt / MC / invoice), Hangfire, PWA, liveness detection, WiFi SSID check, BM language, dashboard auth, production deploy — all explicitly out of scope. Loom narration calls out every demo-vs-quoted-scope delta so reviewers don't misread the demo as feature-complete.

## Core domain concept

[[clock-in-flow]] — six-step orchestration (HMAC verify → parse media + location → fetch selfie → face-match gRPC → haversine geofence → DB write). Two pass flags persisted per attendance row: `face_match_pass`, `geofence_pass`. Either can be false independently — dashboard surfaces both. No auto-rejection; demo shows both signals so the boss decides.

## Stack (May 2026 — LTS / latest stable)

| Layer | Tech |
|---|---|
| Frontend | Next.js 16.2 + Tailwind 4.2 + shadcn/ui v4 + TypeScript |
| Backend | .NET 10 LTS + EF Core 10 + Npgsql Minimal API |
| Face service | Python 3.13 + FastAPI 0.136.1 + grpcio + InsightFace `buffalo_l` (512-D) |
| DB | PostgreSQL 16 (local docker dev; Huawei RDS KL for Loom recording) |
| WhatsApp | Meta Cloud API (direct, no BSP) — Graph API v22 |
| Inter-service | gRPC over HTTP/2 (.NET ↔ Python face service) |
| Container | docker-compose (dev only; production deploy out-of-scope for demo) |

## Layout

```
projects/rintis/tunas-lite/
├── apps/web/              Next.js 16
├── apps/api/              .NET 10 Minimal API
├── services/face/         Python 3.13 FastAPI + gRPC + InsightFace
├── proto/                 face.proto (shared cross-language contract)
├── supabase/              migrations/001_init.sql
├── infra/                 docker-compose.yml, seed-employee.sh
├── docs/                  plan-001.md, parallel-waves.md, progress.md, cycles/
└── CLAUDE.md              project-specific operational rules
```

Local dev: `cd infra && docker compose up -d` → web:3000, api:5000, face:50051 (gRPC) + 8000 (health), db:5432. Meta sandbox webhook needs HTTPS public URL — ngrok or Cloudflare Tunnel.

## Plan-001 status

**Plan:** `projects/rintis/tunas-lite/docs/plan-001.md`. 11 cycles compressed to 6 parallel waves via `docs/parallel-waves.md` (cycle dependency DAG). Six cycles shipped in an overnight run 2026-05-13 → 2026-05-14.

| Phase | Cycle(s) | Status | Shipped |
|---|---|---|---|
| 0 | Repo scaffold | ✅ | 2026-05-13 |
| 1 | 1.1 — DB schema + EF Core | ✅ | 2026-05-13 |
| 2 | 2.1 embed · 2.2 proto · 2.3 face gRPC server | ✅ | 2026-05-13 |
| 3 | 3.1 HMAC · 3.2 parser · 3.3 haversine · 3.4 face client · 3.5 orchestrator · 3.6 GET /attendance | ✅ | 2026-05-13 / 14 |
| 4 | 4.1 — Attendance dashboard table | ✅ | 2026-05-14 |
| 5 | E2E smoke + Loom recording | 🔄 | awaiting real WA send |

Two cycles are **security tier** (opus architect + `Security Reviewer` second-pass): **3.1** (HMAC SHA-256 webhook signature verification, raw body buffering, constant-time compare) and **3.5** (clock-in orchestrator, unknown-sender silent drop, face/geofence failure persistence without auto-accept). Threat models filed in `docs/cycles/3.1.md` + `docs/cycles/3.5.md`.

## Authoritative sources

- Plan: `projects/rintis/tunas-lite/docs/plan-001.md`
- Parallel waves DAG: `projects/rintis/tunas-lite/docs/parallel-waves.md`
- Progress tracker: `projects/rintis/tunas-lite/docs/progress.md`
- Cycle notes: `projects/rintis/tunas-lite/docs/cycles/*.md`
- Partner quotation (stack + scope contract): `projects/rintis/tunas-lite/TUNAS_Lite_Quotation.md`
- Project operational rules: `projects/rintis/tunas-lite/CLAUDE.md`
