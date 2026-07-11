# Runbook

Owner: **SRE** — written for everyone on-call. Action-oriented and usable under stress: the reader is paged at 3 a.m. and needs commands, not theory.

```markdown
# Runbook: [Service Name]
**Owner**: [SRE]  **Last verified**: [date — re-verify commands after every infra change]
**On-call**: [who / channel]

## 1. Service Overview
What it does, in two sentences, for someone seeing it for the first time.
**Stack**: [runtime, host, DB, key dependencies]
**Blast radius**: [what breaks for users when this is down]

## 2. Dashboards & Links
| What | Link |
|------|------|
| Primary dashboard | [...] |
| Logs | [...] |
| Deploy pipeline | [...] |
| SLO doc | [...] |
| Status page | [...] |

## 3. Alert → Action
One row per alert. The action column starts with a command or a check, never prose.
| Alert | Meaning | First action (exact command / check) | If that fails |
|-------|---------|--------------------------------------|---------------|
| [5xx burn rate] | [users failing on X] | [`<command>` — check Y] | [rollback §5 / escalate §4] |

## 4. Escalation Matrix
| Severity | Criteria | Page | Response time |
|----------|----------|------|----------------|
| Sev-1 | [user-facing outage / data at risk] | [who + channel] | [...] |
| Sev-2 | [degraded; error budget burning] | [...] | [...] |

Suspected abuse, data exposure, or compromised secrets → page the security
escalation path immediately, in parallel with mitigation.

## 5. Rollback Procedure
Exact commands — fill the slots, then verify them once for real, not just on paper.
1. Identify last good version: [`<command>`]
2. Roll back: [`<command>`]
3. DB migration involved: [`<down-migration / restore command>` — or "roll-forward
   only", stated explicitly]
4. Confirm rollback is live: [`<command>`]

## 6. Post-Action Verification
After ANY action above, confirm recovery — don't trust the absence of alerts.
- [ ] [health check command / URL + expected response]
- [ ] [dashboard metric back under threshold]
- [ ] [one real user-path smoke action]
- [ ] Incident channel updated with a timestamped status.

## 7. Postmortem
Sev-1/Sev-2 incidents get a blameless postmortem within [X days]: timeline, impact,
root cause, contributing factors, tracked remediation. Template / location: [link].
Postmortem learnings update THIS runbook — a stale runbook is fixed or removed.
```
