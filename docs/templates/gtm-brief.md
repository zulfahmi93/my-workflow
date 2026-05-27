# Go-to-Market Brief

Owner: **Growth Strategist** (with **Product Manager**). A product nobody can find is not a business. Distribution, positioning, and adoption are planned before launch, not after.

```markdown
# GTM Plan: [Feature / Product Name]
**Launch Date**: [date]  **Tier**: 1 (Major) / 2 (Standard) / 3 (Silent)
**Platform**: Flutter (App Store + Play) | React (Web) | Both
**PM**: [name]  **Eng DRI**: [name]  **Growth DRI**: [name]

## 1. What We're Launching
One paragraph: what it is, what user problem it solves, why now.

## 2. Positioning & Differentiation
Why this, why us, why now. The one-line value proposition a user would repeat.

## 3. Target Audience
| Segment | Size | Why They Care | Reach Channel |

## 4. Distribution & Adoption
Channels, onboarding flow, time-to-value, the friction points to remove,
referral/virality loops where relevant.

## 5. Pricing & Packaging implications
What changes about COGS, tier, or willingness-to-pay.

## 6. Launch Checklist
**Engineering**: feature flag, app-store submission lead time, rollback/down-migration, monitoring (SRE sign-off).
**Product/Growth**: in-app announcement, release notes, help article (Technical Writer), distribution assets.
**Quality**: Security sign-off, Test Engineer gates, Code Reviewer approvals.

## 7. Success Criteria
| Timeframe | Metric | Target | Owner |
| Launch day | Error rate | <0.5% | SRE |
| 7 days | Activation | ≥20% | Growth |
| 30 days | Retention delta | +Xpp | PM |

## 8. Rollback Plan
Trigger, owner, channel. Flutter: cannot roll back a released app-store version — hotfix + expedited review. Supabase: down-migration. React/Vercel: instant revert.
```
