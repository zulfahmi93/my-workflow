# Product Requirements Document (PRD)

Owner: **Product Manager**. Written collaboratively — engineers and designers in the doc from the start. If you can't articulate why users will care in one paragraph, you're not ready to write requirements.

```markdown
# PRD: [Feature / Initiative Name]
**Status**: Draft | In Review | Approved | In Development | Shipped
**Author**: [PM]  **Last Updated**: [Date]  **Version**: [X.X]
**Target Platform(s)**: Flutter (iOS/Android) | React/Next.js (Web) | Both
**Backend**: Supabase | ASP.NET | Both
**Stakeholders**: [Eng Lead, Design Lead, Growth, Legal if needed]

## 1. Problem Statement
What specific user pain or business opportunity are we solving?
Who experiences this, how often, and what is the cost of not solving it?

**Evidence:** user research (n=X), behavioral data, support signal, competitive signal.

## 2. Goals & Success Metrics
| Goal | Metric | Baseline | Target | Window |
|------|--------|----------|--------|--------|
| [e.g. Improve activation] | % completing setup | 42% | 65% | 60 days |

## 3. Non-Goals
What this iteration will NOT address (and why) — so the team can say no cleanly.

## 4. User Personas & Stories
**Primary Persona**: [from UX Researcher]
**Story**: As a [persona], I want [action] so that [measurable outcome].
**Acceptance Criteria**:
- [ ] Given [context], when [action], then [expected result]
- [ ] Given [edge case], when [action], then [fallback]
- [ ] Performance: [action] completes under [X]ms at P95
- [ ] Accessibility / trust expectations where relevant

## 5. Solution Overview
Narrative (2–4 paragraphs). Links to design handoff + API contract.
**Key Design Decisions**: chose [A] over [B] because [reason]; trade-off: [what we give up].

## 6. Technical Considerations
**Stack decision**: [Supabase | ASP.NET | both] — rationale (link ADR).
**API contract status**: [Draft | Locked] — link.
**Schema status** / **Security review required (RLS? auth change?)**.
**Dependencies**: [system] — needed for [reason] — owner — timeline risk H/M/L.
**Known Risks**: | Risk | Likelihood | Impact | Mitigation |
**Open Questions** (resolve before dev): [ ] [Q] — owner — deadline.

## 7. Commercial Plan
Positioning, adoption friction, pricing/packaging implications, distribution path,
the activation/retention/conversion metric this is expected to move. (Coordinate with Growth Strategist.)

## 8. Launch Plan
| Phase | Date | Audience | Success Gate | Rollback Trigger |
**Flutter note**: Apple review submission 2–3 days before target release.
**Rollback owner**: [name] — paged via [channel].

## 9. Appendix
Links: UX research, design handoff, OpenAPI spec, ERD/migration plan, ADRs, threat model/sign-off.
```
