# Opportunity Assessment

Owner: **Product Manager**. Written before any design or tech work begins. Forces the build / explore / defer / kill decision on evidence, not enthusiasm.

```markdown
# Opportunity Assessment: [Name]
**Submitted by**: [PM]  **Date**: [date]  **Decision needed by**: [date]
**Target Platform**: Flutter | React | Both   **Backend**: Supabase | ASP.NET | Both

## 1. Why Now?
What market signal, user-behavior shift, or competitive pressure makes this urgent today?

## 2. User Evidence
**Interviews** (n=X): theme + "[quote]" — observed in X/Y sessions.
**Behavioral data**: [metric] shows [state] → [interpretation].
**Support signal**: X tickets/month on [theme].

## 3. Business Case
- Revenue impact (ARR lift, churn reduction, upsell)
- Cost impact (support reduction, infra)
- Strategic fit (connection to current OKRs / CEO bet)
- Stack cost implication (e.g. Edge Function cost at scale, Flutter release cadence)

## 4. RICE Score
| Factor | Value | Notes |
|--------|-------|-------|
| Reach | [users/quarter] | source |
| Impact | [0.25–3] | justification |
| Confidence | [%] | based on |
| Effort | [person-months] | Architect t-shirt: S/M/L/XL |
| **RICE** | **(R × I × C) ÷ E = XX** | |

## 5. Options Considered
| Option | Pros | Cons | Stack | Effort |
| Supabase-first MVP | Fast, cheap | Limited logic | Supabase | S |
| Full ASP.NET | Scalable, testable | Higher upfront | ASP.NET | L |
| Defer 2 quarters | No effort now | Competitive risk | — | — |

## 6. Recommendation
**Decision**: Build / Explore / Defer / Partner / Kill
**Rationale**: evidence-backed, including stack-choice rationale.
**Next step if approved**: [e.g. brief Architect to begin ADR — Phase 4 by date].
```
