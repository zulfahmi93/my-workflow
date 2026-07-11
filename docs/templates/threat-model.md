# Threat Model

Owner: **Security Reviewer**. No architecture passes without a STRIDE pass over its components, actors, and trust boundaries. Lead with the exploit path and the business impact, not the CVE number — and never let residual risk be accepted silently.

```markdown
# Threat Model: [System / Feature Name]
**Owner**: [Security Reviewer]  **Date**: [date]  **Status**: Draft | Reviewed | Signed off
**Scope**: [components/flows in scope — name what is explicitly OUT of scope]

## 1. System & Trust Boundaries
Components, actors (users, admins, services, third parties), and the trust
boundaries between them. Link the architecture diagram / data flow.
**Assets worth attacking**: [data, credentials, sessions, money, compute, reputation]

## 2. STRIDE Pass
One pass per component / trust boundary. Classes: Spoofing, Tampering, Repudiation,
Information disclosure, Denial of service, Elevation of privilege.

| # | Threat | STRIDE | Asset | Exploit path | Impact | Likelihood | Mitigation | Owner | Status |
|---|--------|--------|-------|--------------|--------|------------|------------|-------|--------|
| T1 | [forged webhook triggers payout] | S | payments | [unsigned POST to /webhook accepted] | High | Med | [HMAC signature verification] | [agent] | Open / Mitigated / Accepted |

Never dismiss on "low likelihood" alone — weigh impact and exploitability together.

## 3. Mitigation Verification
How each mitigation is proven, not just claimed: [negative test, RLS positive +
negative test, config review, dependency scan]. Link tests/checks per threat ID.

## 4. Residual-Risk Register
Anything not fully mitigated lands here. Every row requires explicit business
acceptance by CEO/CTO/Product — silent acceptance is non-compliant.

| # | Residual risk | Why not fully mitigated | Business impact | Accepted by | Date |
|---|---------------|-------------------------|-----------------|-------------|------|
| R1 | [...] | [...] | [...] | [name — CEO / CTO / Product] | [date] |

**Sign-off**: I understand and accept the residual risks above on behalf of the
business. — [name, role: CEO | CTO | Product Manager], [date]

## 5. Cycle-Note Mapping
Security-tier cycles (.agents/rules/cycle-orchestration.md §Security tier) must
file a `threat-model` block in their cycle note. Lift it from this doc:
- `attacker-can[]` ← §2 exploit-path column — what the attacker can do
- `mitigation-blocks[]` ← §2 mitigation column — what each mitigation blocks
- `residual-risk[]` ← §4 register — what remains, and who accepted it
```

File alongside the project's ADRs (`<project>/docs/`) and link it from the PRD §9 Appendix.
