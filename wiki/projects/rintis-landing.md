---
name: rintis-landing
description: LEGACY marketing landing site for Rintis Tech (rintis.tech). Superseded 2026-06-25 by `landing-website/` after company rebrand to Berdua.AI (legal Berdua Sdn. Bhd.). Kept as historical record.
metadata:
  type: project
  status: superseded
  superseded_by: landing-website
  last_ingested: 2026-05-17
---

# Rintis Tech Landing — _legacy_

> **Superseded 2026-06-25.** Company rebranded to **Berdua.AI** (legal: **Berdua Sdn. Bhd.**). Active landing now lives at `projects/rintis/landing-website/` (new design system, new content). This page documents the prior brand for history; do not edit, do not deploy, do not resurrect without owner approval.

**Status:** Site scaffolded + content shipped (legacy). Deploy pipeline was live on `dev.rintis.tech` (CF Worker `rintis-landing-dev`); `main` → `rintis.tech` prod path ready, gated on required-reviewer approval. No `plan-XXX.md` filed (PRD-driven, no TDD scaffold — see `[[design-system-pivot]]` for the visual-system source of truth at the time).

## What

Single-page marketing landing for the company under the **Rintis Tech** brand at `rintis.tech`. App Router Next.js 16 site with 11 stacked sections (Hero → About → Services → Why → Process → Team → Governance → Success → Engage → Demo → Contact → Footer), a WebGL `waterPlane` shader hero (`@shadergradient/react` + `three`), and a brand-mandated lime-stripe band closing every page above the footer. Static-export-friendly; no auth; no server personalization in v1.

## Why

Public face of the company. **Domain split is load-bearing:** legal entity is **Rintis AI** but `rintis.ai` was out of budget when this landing was scoped, so all public copy ships under **Rintis Tech** on `rintis.tech` until the `.ai` domain becomes affordable. Repo + GitHub org stay "Rintis AI" internally — intentional.

PRD-driven, **not** TDD-driven. The guarantee surface is post-deploy: Playwright + axe (no critical/serious a11y violations), Lighthouse CI (perf ≥ .85, a11y ≥ .95, SEO ≥ .95), and an HTTP smoke (200 + content asserts). That stack is the de-facto test gate per [`docs/deploy.md` §"Why no TDD red/green here?"](../../projects/rintis/rintis-landing/docs/deploy.md).

## Core domain concept

[[design-system-pivot]] — token-locked editorial design system (Fraunces + Inter, dark ink-0…ink-4 forest-greens, lime accent, `--rt-*` CSS-variable prefix). On 2026-05-17 the brand pivoted from the original Mistral-inspired sunset/cream system (orange `#fa520f` primary, PP Editorial Old, sunset-stripe band) to the **forest-green + lime** system that ships on v1. The repo-level `projects/rintis/rintis-landing/CLAUDE.md` still documents the prior Mistral system and lags the pivot — `DESIGN.md` v-alpha is the source of truth.

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16.2.6 (App Router) + React 19.2.6 + TypeScript ^6 |
| Styling | Tailwind 4 (`@tailwindcss/postcss`) + CSS variables (`--rt-*`) bridged from `DESIGN.md` |
| Hero shader | `@shadergradient/react` ^2.4.20 + `@react-three/fiber` ^9.6.1 + `three` ^0.184.0 |
| Hosting | Cloudflare Workers via `@opennextjs/cloudflare` ^1.19.10 + `wrangler` ^4.92 |
| CI gates | ESLint ^9 (pinned, see below), `tsc --noEmit`, Playwright ^1.60 + `@axe-core/playwright` ^4.11, Lighthouse CI ^0.15.1 (forced to Lighthouse ^13.0.2 via npm `overrides`) |
| Smoke | `scripts/smoke.sh` (HTTP 200 + content asserts) |

**Pinned deps with unblock triggers** (don't bump blindly — see [`deploy.md` §"Pinned dependency versions"](../../projects/rintis/rintis-landing/docs/deploy.md)):

- `eslint: ^9` — blocked on `eslint-plugin-react` (transitive via `eslint-config-next@16.2.6`) gaining ESLint-10 compat. ESLint 10 removed `context.getFilename()` and the React rule still calls it — `npm run lint` crashes on the first `.tsx` file. Watch `vercel/next.js/packages/eslint-config-next/package.json`.
- `lighthouse: ^13.0.2` (via `overrides` against `@lhci/cli`) — `@lhci/cli@0.15.1` bundles Lighthouse 12, which flagged Cloudflare's "Managed robots.txt" `Content-Signal:` directive as invalid and dropped SEO to 0.92. Lighthouse 13 fixed parsing ([GoogleChrome/lighthouse#16767](https://github.com/GoogleChrome/lighthouse/pull/16767)). Drop the override when lhci ships a Lighthouse-13 bundle.

## Layout

```
projects/rintis/rintis-landing/
├── app/
│   ├── _components/        Hero shader, sections, nav, counters, waveforms,
│   │                       WhatsApp demo, icons, reveal, reduced-motion hook
│   ├── globals.css         --rt-* CSS variable definitions
│   ├── layout.tsx
│   ├── page.tsx            11 stacked sections + Nav + Footer
│   ├── robots.ts
│   └── sitemap.ts
├── public/assets/          Logo (black + white), team images
├── docs/
│   ├── branding/logo.png   Single canonical brand asset (do NOT regenerate)
│   ├── profiles/1-10.png   READ-ONLY copy source (team bios, capability blurbs)
│   └── deploy.md           Deploy + CI runbook (auth, secrets, rollback)
├── tests/e2e/smoke.spec.ts
├── scripts/smoke.sh
├── DESIGN.md               Token-locked design system (alpha; @google/design.md grammar)
├── AGENTS.md               "This is NOT the Next.js you know" — Next 16 breaking-changes warning
├── CLAUDE.md               Project-local rules (LAGS the design-system pivot)
├── wrangler.jsonc          CF Worker config — dev + prod envs
├── lighthouserc.cjs
├── playwright.config.ts
├── open-next.config.ts
├── next.config.ts
└── package.json
```

Local dev: `npm run dev` → `http://localhost:3000`. Worker simulation before push: `npm run preview` (OpenNext build + local Worker runtime). Smoke against any URL: `SMOKE_URL=http://localhost:3000 npm run smoke`.

## Plan status

No `docs/plan-XXX.md` or `docs/progress.md` filed. PRD lives implicitly in `DESIGN.md` (visual contract) + `docs/profiles/*.png` (copy source). Stack + content already shipped to `dev.rintis.tech`. Suggested future cycles (none scoped yet):

| Cycle / area | Status |
|---|---|
| Initial scaffold (Next 16 + Tailwind 4 + shader hero + 11 sections) | ✅ shipped |
| Deploy pipeline (CF Worker dev + prod via GitHub Actions) | ✅ shipped to dev; prod gated on reviewer |
| Brand pivot — Mistral-sunset → forest-green + lime | ✅ shipped 2026-05-17 in `DESIGN.md`; CLAUDE.md update pending |
| Domain switchover plan (Rintis Tech → Rintis AI when `.ai` affordable) | 📝 open question (v2) |
| Photography source (commissioned / licensed / AI-generated mountain-sunset → likely retire with the sunset pivot) | 📝 open question |
| Profile content extraction (read PNGs per task vs. OCR once into JSON) | 📝 open question |
| Contact form backend | 📝 not yet scoped — first plausible TDD surface |

## Deployment topology

| Env | Worker | URL | Trigger |
|---|---|---|---|
| dev | `rintis-landing-dev` | `dev.rintis.tech` | push to `develop` |
| prod | `rintis-landing-prod` | `rintis.tech` + `www.rintis.tech` | push to `main` (required reviewer) |

PR pipeline: lint + typecheck + Next build + OpenNext build — no deploy. Deploy pipelines (per env): install → lint → typecheck → next build → opennext build → `wrangler deploy --env <env>` → smoke (HTTP 200 + content) → lighthouse (perf ≥ .85, a11y ≥ .95, SEO ≥ .95) → playwright + axe (no critical/serious). Rollback: `npx wrangler rollback --env prod` or dashboard.

## Authoritative sources

- Project operational rules: `projects/rintis/rintis-landing/CLAUDE.md` (note: brand-color section lags the pivot)
- Design system (source of truth): `projects/rintis/rintis-landing/DESIGN.md`
- Deploy + CI runbook: `projects/rintis/rintis-landing/docs/deploy.md`
- Copy source (read-only): `projects/rintis/rintis-landing/docs/profiles/1-10.png`
- Brand logo (canonical): `projects/rintis/rintis-landing/docs/branding/logo.png`
- Next 16 breaking-change warning for agents: `projects/rintis/rintis-landing/AGENTS.md`
- Page composition: `projects/rintis/rintis-landing/app/page.tsx` + `app/_components/sections.tsx`
