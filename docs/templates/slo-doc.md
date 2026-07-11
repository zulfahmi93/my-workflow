# SLO Document

Owner: **SRE**. Never commit to an SLO you can't observe — an SLO without a real, queryable SLI and a dashboard is non-compliant, not aspirational.

```markdown
# SLOs: [Service / Product Name]
**Owner**: [SRE]  **Date**: [date]  **Review cadence**: [e.g. quarterly + after every Sev-1]

## 1. Critical User Journeys
SLOs attach to journeys users and revenue depend on, not to servers.
| CUJ | User expectation | Business impact if degraded |
|-----|------------------|------------------------------|
| [teacher submits clock-in] | [confirmation < 2 s] | [payroll dispute, trust loss] |

## 2. SLOs
One block per SLO. An SLO without a queryable SLI is non-compliant.

### SLO-1: [name, e.g. clock-in availability]
- **SLI specification**: [the actual queryable definition — query + source, e.g.
  `sum(rate(http_requests_total{route="/clock-in",code!~"5.."}[5m]))
   / sum(rate(http_requests_total{route="/clock-in"}[5m]))` on Prometheus,
  or the provider-analytics equivalent]
- **Target**: [e.g. 99.5%]
- **Measurement window**: [e.g. rolling 30 days]
- **Error budget**: [e.g. 0.5% ≈ 3.6 h per 30 d]
- **Dashboard**: [link — required before the SLO counts as live]

## 3. Error-Budget Policy
What happens as budget burns — agreed with the Product Manager before the first breach.
| Budget state | Action |
|--------------|--------|
| > 50% remaining | [normal feature work] |
| < 50% remaining | [reliability work prioritized alongside features] |
| Exhausted | [feature freeze on the affected path; PM/CTO informed] |

## 4. Alert Mapping
Every alert is actionable and owned; noisy alerts get fixed or removed.
| Alert | Threshold | Action (runbook link) | Owner |
|-------|-----------|------------------------|-------|
| [fast burn] | [e.g. 2% of budget in 1 h] | [runbook §Alert → Action row] | [on-call] |

## 5. Commitments & Review
External commitments these SLOs back: [customer promise, contract, support tier].
Last review: [date] — changes made: [...]
```
