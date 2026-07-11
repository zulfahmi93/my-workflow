# Vendor & Lock-in Register

Owner: **CTO**. One entry per standardized vendor, platform, or major dependency the company commits to (Supabase, a model provider, a host, a payments processor, an observability SaaS). A lock-in you've priced is a strategy; one you haven't is a liability. Write the exit cost **before** standardizing, not after the bill doubles.

## Per-vendor entry

```markdown
# Vendor Bet: [Vendor / Platform]
**Capability**: [what it provides — auth, DB, inference, hosting, payments, ...]
**Standardized for**: [which projects / which capability class]
**Adopted**: [date]   **Owner**: CTO   **Last reviewed**: [date]

## Lock-in depth
Shallow (swappable in days) | Medium (weeks) | Deep (re-architecture)

## Cost trajectory
Now: [$/month or $/unit]  →  At projected scale: [$ at N× volume]
COGS / margin impact: [how it moves unit economics]

## Exit cost
Engineering-weeks + risk to migrate off. What's portable, what's proprietary.
Abstraction in place? (interface that isolates the vendor — yes/no/partial)

## Re-evaluation trigger
The signal that forces a review: [cost threshold, SLA breach, strategic shift,
deprecation, security incident, scale ceiling].

## Decision
Accept lock-in / Abstract behind interface / Avoid / Migrate by [date]
Research backing (Mandatory Research Standard — .agents/rules/lifecycle.md): [link/ADR]
```

## Portfolio register (roll-up)

Keep a one-row-per-vendor summary so the whole posture is visible at a glance:

| Vendor | Capability | Lock-in | Cost now → at scale | Exit cost | Re-eval trigger | Decision |
|---|---|---|---|---|---|---|
| [e.g. Supabase] | DB + Auth + Edge | Medium | $25/mo → $X | ~2 wks (PostgREST proprietary) | >1M req/mo or SLO breach | Abstract data access behind a repo layer |
| [e.g. Anthropic] | LLM inference | Shallow | $/token | <1 wk (swap SDK) | cost-per-interaction > budget | Accept; keep prompt layer provider-agnostic |

**Rule:** no vendor reaches "standardized" status without a register entry. Review the whole register each strategy cycle (Phase 1) and whenever a re-evaluation trigger fires.
