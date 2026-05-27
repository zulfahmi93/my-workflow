---
name: susun-jadual-roundtable-2026-05
description: 3-agent Opus roundtable critique of [[susun-jadual]] plan-001 v1 (2026-05-19). 24 consensus findings, 5 disagreements resolved, 17 amendments applied — produced plan-001 v2.
metadata:
  type: project
  status: synthesis-complete
  parent_project: susun-jadual
  last_ingested: 2026-05-19
---

# Susun Jadual — Plan-001 Roundtable (2026-05-19)

A multi-POV critique of [[susun-jadual]] plan-001 v1, conducted same-day as the v1 scaffold. Three Opus agents (Software Architect, Product Manager, UX Researcher) each wrote an independent POV, then debated via SendMessage across two rounds before the architect compiled a joint verdict.

## Outputs

- **POVs** (raw individual analyses):
  - `projects/susun-jadual/docs/roundtable/architect.md` — 12 findings, stack/architecture lens
  - `projects/susun-jadual/docs/roundtable/pm.md` — 12 findings, commercial/GTM lens
  - `projects/susun-jadual/docs/roundtable/ux.md` — 10 findings, user-fit lens
- **Joint verdict:** `projects/susun-jadual/docs/roundtable/joint-verdict.md` — 24 consensus items + 5 disagreements + 17 amendments + Hetzner unanimous

## What the roundtable found

**Headline:** plan-001 v1 was *technically competent but commercially and experientially undercooked*. Engineering scaffolding sound; cycle ordering defensible; verifier pattern exemplary. But several load-bearing surfaces were silently missing — pilot acquisition path, failure-mode UX, PDPA posture, payload-snapshot reproducibility, structured infeasibility output, allocation-matrix interaction model. These compound non-linearly if discovered post-Phase-2.

### Top 9 consensus `[BLOCKER]` findings

1. **C1 — Phase 0.5 Discovery before Phase 1.** Constraint shape from real Malaysian schools must be locked before Cycle 2.2. Cost to retrofit a missed constraint: ~30 min at 2.2, ~4h at 4.x.
2. **C2 — Unified failure-mode output schema** (`done | partial | timeout | failed | infeasible` + structured `recovery_hints` + human-readable BM/EN strings). Locks solver contract, worker output shape, UI rendering.
3. **C3 — `generation_jobs.input_payload` jsonb snapshot.** Without it, reproducibility breaks; pilot conversation "this is what we generated for you" collapses.
4. **C4 — OpenAPI-driven Pydantic ↔ .NET contract.** Drift surfaces as 422 mid-Cycle 4.2 with no diagnostic.
5. **C5 — Determinism + multi-worker config.** Production `num_search_workers=4` (non-deterministic); tests single-worker fixed-seed; assertions on feasibility + bounded objective gap, not bit-identical placements.
6. **C6 — Period-allocation matrix interaction model.** Three states (pristine/overridden/manual) + inline (not modal) bulk-fill + persistent live-counter. Schema column `period_allocations.override_source`.
7. **C7 — Lock-this-cell via CP-SAT assumptions.** Non-deterministic re-runs need pin mechanism. Architecturally clean via `solver.AddAssumption(...)`. Pulls minimal slice of plan-002 "diff view" forward.
8. **C8 — PDPA 3-touch posture.** Schema in Cycle 1.1; consent UI in new Cycle 3.1.5; data subject rights endpoints in new Cycle 4.4.
9. **C9 — Infeasibility translation layer.** Raw constraint IDs destroy pilot conversion at the failure moment. Server-side `InfeasibilityExplainer` produces BM/EN sentences with deep-links.

Plus 15 `[ACTION]` items and 1 `[PRAISE]` (verifier pattern + security-tier flagging + honesty boundary + stack discipline).

## DigitalOcean vs Hetzner — joint recommendation

**Hetzner CPX31 SG.** Unanimous across all three reviewers.

| Lens | Argument |
|---|---|
| **Cost (PM)** | DO `s-4vcpu-8gb` ~4× Hetzner CPX31 ($48 vs €12). 16% of marginal cost per 30-class school. 1.5 months extra runway/year at 100 schools. |
| **CPU/core (architect)** | Hetzner CPX31 (AMD Epyc) marginally beats DO on CPU-bound CP-SAT workloads. |
| **Latency (UX)** | SG→KL ≤ 25ms on both; user is already waiting 1–20 min for solver — network jitter invisible. |
| **Currency (PM)** | EUR/MYR less volatile than USD/MYR over 24 months. |
| **Bandwidth** | Hetzner 20 TB included; DO 5 TB. Both over-provisioned. |
| **Managed Postgres** | Neutral — Supabase covers DB on both. |

Revisit at 50+ paying schools or if MYR/EUR weakens >15%.

## Disagreements (D1–D5) and user resolutions (2026-05-19)

| ID | Topic | Architect default | UX position | PM position | **User decision** |
|---|---|---|---|---|---|
| D1 | i18n / BM commitment | conditional on PM | scaffold next-intl in Cycle 3.1 | silent | **Scaffold in Cycle 3.1 (UX)** — BM commitment for plan-002 |
| D2 | Teacher unavailability UI | API + schema only; defer UI | implicit support | demoware without it | **Full calendar UI (PM)** — added Cycle 3.2.5 |
| D3 | Share-via-WhatsApp URL | defer to plan-002 | ship in plan-001 | silent | **Ship signed share URL (UX)** — added Cycle 5.1c security-tier |
| D4 | Save-and-resume mechanism | server-side draft table | echoes need | localStorage equivalent | **Server-side draft (architect)** |
| D5 | Lock-this-cell scope | joint adopt | joint adopt | silent | **Adopt (joint default)** |

## Net scope impact

- **Original plan-001 v1:** ~26h, 17 TDD cycles + Phase 0
- **Verdict amendments (A1–A17):** +31h
- **D2 calendar UI (Cycle 3.2.5):** +3h
- **D3 signed share URL (Cycle 5.1c):** +4h
- **Plan-001 v2 total:** ~64h, 25 TDD cycles + Phase 0 + Phase 0.5 Discovery + Phase 7 Pilot launch

Roughly 2.5× original. Each amendment closes a `[BLOCKER]` that would otherwise surface mid-Phase-4 at much higher cost.

## Honesty boundary — praised + reinforced

All three reviewers independently praised the [[susun-jadual]] honesty boundary ("AI-assisted setup, deterministic solver — never hallucinates teachers"). Recommended marketing the verifier-pattern more aggressively in pilot conversations as a positive differentiator vs hypothetical LLM-only competitors.

PM Finding #7 captured the framing tightening: lead with "Battle-tested solver — never hallucinates teachers" (positive); follow with "AI helps you describe rules" (LLM auxiliary). Demo video showing the independent verifier confirming results = proof-by-demonstration of the honesty claim. Codified in Phase 7 copy-deck task.

## Authoritative sources

- Verdict: `projects/susun-jadual/docs/roundtable/joint-verdict.md`
- Individual POVs: `projects/susun-jadual/docs/roundtable/{architect,pm,ux}.md`
- Resulting plan: `projects/susun-jadual/docs/plan-001.md` (v2)
- Parent project card: [[susun-jadual]]
- Core concept: [[timetable-csp]]
