# Architecture Decision Record (ADR)

Owner: **Software Architect**. One ADR per significant architecture decision. The ADR captures the *why*, not just the *what* — a diagram without reasoning is decoration.

```markdown
# ADR-XXX: [Decision Title]

## Status
Proposed | Accepted | Deprecated | Superseded by ADR-XXX

## Context
What is the business problem or technical constraint driving this decision?
What have we tried? What are the constraints (team size, timeline, tech debt)?

## Research
Per the Mandatory Research Standard (.agents/rules/lifecycle.md): the options
compared, and the evidence across maturity, ecosystem, operational burden,
cost (now and at scale), performance, security, hiring/maintenance, and lock-in.

## Decision
What are we choosing and why?
State the trade-offs explicitly: what we gain, what we give up.

## Consequences
What becomes easier? What becomes harder?
What's the cost to reverse this decision later? (reversibility)
What's the cost to build on top of it?

## Commercial impact
COGS / margin / time-to-market / differentiation effect, where relevant.

## Alternatives Considered
[Option A]: Pros / Cons / Why rejected
[Option B]: Pros / Cons / Why rejected

## Related ADRs
[Link to dependent or conflicting ADRs]
```

Project-specific ADR location: typically `<project>/docs/adr/` or `<project>/docs/decisions/`; create the folder if neither exists.
