# Test Plan

Owner: **Test Engineer**. Weight effort by commercial and user risk, not by what is easy to test — the highest-value paths deserve the strongest coverage.

```markdown
# Test Plan: [Feature / Release Name]
**Owner**: [Test Engineer]  **Date**: [date]  **Plan ref**: [plan-NNN.yaml / cycle range]

## 1. Risk-Weighted Scope
Highest-value user paths first. Rank by what a failure costs the user/business.
| Priority | Path / behavior | Risk if broken | Coverage target |
|----------|-----------------|----------------|-----------------|
| P0 | [e.g. clock-in submit + confirmation] | [payroll dispute, trust loss] | [E2E + integration + unit] |

**Out of scope this round**: [what is not tested, and why that is acceptable]

## 2. Test Pyramid
What lives at each layer. Every behavior covers happy path + boundary + error
(.claude/rules/tdd.md §Test quality).
| Layer | What lives here | Tooling | Runtime budget |
|-------|-----------------|---------|----------------|
| Unit | [pure logic; external clients mocked] | [...] | < 1 s/test |
| Integration | [real DB, API wire-level, RLS positive + negative] | [...] | < 30 s/test |
| E2E / UI | [P0 journeys only] | [...] | [...] |

## 3. Fixtures & Harness
Follow .claude/rules/tdd.md §Test harness conventions (Testcontainers / pgTAP,
mocked LLM clients in unit suites, integration skip rules) — do not restate them.
Project-specific fixtures, images, and data quirks: [link project CLAUDE.md §...]

## 4. CI Gates
| Gate | Command | Blocks |
|------|---------|--------|
| [full unit + integration suite] | [exact command] | merge |
| [coverage floor on changed lines] | [...] | merge |

**Flaky-test policy**: per .claude/rules/tdd.md §Test quality — root-cause the day
it appears; quarantine only with owner + expiry; never retry-loop.

## 5. Release Test Evidence
Filled at release time — this section is the go/no-go artifact.
**Commands run**: [exact commands + exit codes]
**Result**: [Passed: N / Failed: 0, per suite]
**Environment**: [OS, runtime, DB image versions, relevant env flags]
**Coverage**: [number + what it does and does not mean here]
**Known risks / uncovered areas**: [explicit list, each with rationale]
**Go/No-Go recommendation**: GO | NO-GO — [one-line reason]
```
