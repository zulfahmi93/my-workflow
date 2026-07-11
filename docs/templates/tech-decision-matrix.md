# Technology decision matrices

Owner: **Software Architect** (within **CTO** standards). Stack defaults for this repo's stack (Flutter, React, Supabase, ASP.NET Core). These encode hard-won defaults — deviate only with an ADR and the research to back it. Pair with the Mandatory Research Standard in [`.agents/rules/lifecycle.md`](../../.agents/rules/lifecycle.md).

## Supabase vs ASP.NET Core

| Dimension | Supabase | ASP.NET |
|-----------|----------|---------|
| **Product stage** | MVP, early validation, <50k users | Scaling past MVP, complex rules, enterprise |
| **Data model** | Simple, relational, straightforward RLS | Complex multi-tenant, coordinated transactions, sagas |
| **Business logic** | Thin (CRUD + RLS), simple workflows | Complex state machines, orchestration, regulatory logic |
| **Auth** | OAuth, JWT, simple role-based | Hierarchical roles, MFA, hybrid OAuth + internal |
| **API contract** | PostgREST auto-generated | Explicit REST/gRPC, versioning strategy |
| **Scaling pressure** | <1M req/month | >1M req/month, strict SLOs |
| **Time-to-market** | 2–4 weeks to working API | 4–8 weeks (architecture, patterns, testing) |
| **Cost at scale** | PostgreSQL + Edge Functions plateau | Predictable linear cost with instances |

**Decision rule:** Choose Supabase if >80% of the feature is CRUD + RLS. Choose ASP.NET for complex multi-step logic, saga patterns, or deep third-party orchestration.

## Flutter vs React vs Both

| Decision | Flutter | React | Both |
|----------|---------|-------|------|
| **Users primarily mobile** | Yes | No | If <20% web base |
| **Native capabilities** | Camera, biometrics, push, local persistence | PWA-planned | Both, parity maintained |
| **Web presence required** | Flutter Web has limits | Default for web | Separate teams, shared API contract |
| **SEO critical** | N/A | Next.js App Router SSR | N/A |

**Decision rule:** Flutter first if mobile-only and native capabilities are core. React first if web is primary. Both only if cross-platform parity is a real user expectation.

## BLoC design scope (Flutter)

| Scope | Rule |
|-------|------|
| **New data domain** | = New BLoC (NotificationBloc separate from AuthBloc) |
| **Cross-domain coordination** | Events + `bloc.add()` or shared lower-level state |
| **Transient UI state** | Provider / local setState |
| **Persistent / shared-across-screens state** | One BLoC per shared domain |

**Rule of thumb:** two screens needing the same data → share one BLoC. A feature adding a new data domain → new BLoC.

## API contract-first

| Stage | Rule | Consequence |
|-------|------|-------------|
| **Before Flutter dev** | Lock contract; freezed models generate from it | Post-generation changes compound cost |
| **Before React dev** | Lock Zod schema; TanStack cache keys depend on it | Schema changes break query logic |
| **Post-launch** | Version the API, don't break the contract | v1/v2 coexist; clients migrate at their pace |

**Decision rule:** No implementation begins until the API contract is reviewed and approved by backend + frontend. Lock it in writing (OpenAPI or ADR).

## Edge Functions vs ASP.NET business logic

| Responsibility | Edge Function | ASP.NET |
|---|---|---|
| **Single-request transforms** | Yes | Pass through |
| **Cross-table queries w/ RLS** | PostgREST + RLS | Complex → delegate |
| **Third-party calls** | Short timeout, webhooks | Long-running, retry, queue |
| **State coordination** | Simple RLS checks | Saga, distributed txns |

**Rule:** Edge Functions for thin logic completing <5s with no external orchestration. Anything coordinating multiple systems → ASP.NET.

## C4 communication levels

Match the diagram to the audience. **L1 System Context** (execs): users, system, external integrations. **L2 Container** (tech leads): apps, API, DB, queue, externals. **L3 Component** (engineers): controllers, services, repos, BLoCs. **L4 Code** (deep-dive only): classes, signatures. Start at L1, agree scope, descend only as far as the decision needs.
