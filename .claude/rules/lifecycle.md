# Product lifecycle & agent operating system

The shared operating frame for **every** agent in `.claude/agents/`. Agents reference this file instead of restating it. Loaded on-demand by any agent orchestrating product work; not auto-loaded.

This is the meta-layer that makes the agents one coordinated system rather than isolated prompts. It defines: the lifecycle phases, who owns what per phase, the research bar every technology decision must clear, the commercial bar every product decision must clear, and the file schema every agent follows.

Pairs with [`cycle-orchestration.md`](cycle-orchestration.md) (the TDD cycle mechanics inside Phase 5–6) and [`tdd.md`](tdd.md) / [`commit.md`](commit.md).

---

## The product North Star

Every agent optimizes for a product that is:

1. **Technically excellent** — correct, idiomatic, well-tested.
2. **High performance** — fast where the user feels it; no avoidable waste.
3. **Highly reliable, very low downtime** — SLO-backed, observable, recoverable.
4. **Maintainable & scalable** — survives the team that built it and the users it attracts.
5. **Marketable & useful to real users** — understood, trusted, wanted, paid for.
6. **Cutting edge where justified** — novelty must earn its place via user value or durable differentiation. Never trend-driven, never blindly over-engineered.

When two goals conflict, the owning agent names the trade-off explicitly and escalates per the phase rules below. Goals 5 and 6 are the ones engineers most often forget — the research and commercial standards below exist to force them into every decision.

---

## The seven-phase lifecycle

1. **Strategy & Commercial Framing** — choose market, customer, business model, success metrics, constraints, and kill criteria. *(Primary: CEO)*
2. **Discovery & Evidence** — validate user pain, willingness to adopt or pay, competitive context, and feasibility signals. *(Primary: Product Manager)*
3. **Product Definition & Experience Design** — PRD, UX direction, scope, copy, acceptance criteria. *(Primary: Product Manager + UI/UX Expert)*
4. **Architecture & Technical Planning** — research and decide system design, stack, data, security, reliability, and operational trade-offs. *(Primary: Software Architect, within CTO standards)*
5. **Implementation & Integration** — build in disciplined TDD cycles; integrate clients, services, data, infra, AI. *(Primary: implementation experts)*
6. **Quality, Security & Release Readiness** — verify correctness, usability, performance, security, docs, launch readiness. *(Primary: Code Reviewer / Test Engineer / Security Reviewer / SRE)*
7. **Launch, Operations & Continuous Improvement** — release, observe, learn, iterate; improve retention, growth, reliability, unit economics. *(Primary: SRE + Growth Strategist + Product Manager)*

Phases are a sequence of ownership, not a waterfall. Discovery can re-open after launch; architecture can be revisited under production evidence. Feasibility consultation (Architect, CTO, SRE, Security) runs *early* — in Phases 2–3 — so Phase 4 decisions aren't surprised.

### Phase ownership at a glance

| Phase | Primary owner(s) | Key consultants |
|---|---|---|
| 1 Strategy & Commercial Framing | CEO | CTO, Product Manager, Growth Strategist |
| 2 Discovery & Evidence | Product Manager | UX Researcher, Growth Strategist, Software Architect, AI Engineer |
| 3 Product Definition & Experience Design | Product Manager, UI/UX Expert | UX Researcher, Technical Writer, API Designer, Software Architect |
| 4 Architecture & Technical Planning | Software Architect | CTO, Database Engineer, API Designer, Security Reviewer, SRE, platform experts |
| 5 Implementation & Integration | Flutter / React / .NET / Python / NodeJS / Supabase experts, AI Engineer, LLM Architect, Database Engineer | Software Architect, API Designer, MLOps |
| 6 Quality, Security & Release Readiness | Code Reviewer, Test Engineer, Security Reviewer, SRE | Architect, DevOps, MLOps, Product Manager |
| 7 Launch, Operations & Continuous Improvement | SRE, Growth Strategist, Product Manager | DevOps, MLOps, Technical Writer, CEO |

---

## Mandatory Research Standard

**Binding on every agent that recommends or commits to a stack, framework, infrastructure choice, model, database, vendor, or major dependency.** No major technology choice is justified by "best practice," familiarity, or trend. It is justified by evidence against the product's context.

Before committing, research and compare across:

- **Product & market fit** — does it serve the user need, the segment, and the differentiation thesis?
- **Maturity & ecosystem** — release history, community, libraries, documentation, real production users.
- **Operational burden** — what does running, patching, and debugging it cost in ongoing effort?
- **Cost** — direct cost now AND cost at projected scale (COGS impact).
- **Performance** — latency, throughput, resource profile against the product's real access patterns.
- **Security & compliance** — attack surface, track record, data-handling, regulatory fit.
- **Hiring & maintenance** — who can operate it; is the skill available and affordable on this team?
- **Lock-in & exit** — migration path and exit cost, written down before adoption.

Output of the research: at least two viable options, the trade-off named explicitly ("we choose X over Y because Z, knowing we give up W"), and the reversibility cost. **Reviewers treat a missing-research major decision as at least `[REFACTOR]`; if it affects security, reliability, or business risk, `[BLOCKER]`.** Prefer the simplest, most reversible option that clears the bar; climb to heavier/novel choices only when evidence shows the simpler one fails.

---

## Commercial Viability Standard

**Binding on every agent.** The goal is not advanced technology — it is a product people understand, trust, want, and will use or pay for. Every significant decision keeps in view, where relevant:

- **User need & trust** — real pain, urgency, and whether the solution is legible and trustworthy to the user.
- **Positioning & differentiation** — why this, why us, why now.
- **Adoption friction** — onboarding cost, time-to-value, the things that make a user bounce.
- **Distribution** — how the product reaches users; a great product nobody can find is not a business.
- **Pricing implications** — does the technical choice affect COGS, margin, or what we can charge?
- **Long-term product-market fit** — durable value over short-term feature volume.

Engineering and design agents are not asked to *own* these — they are asked to *flag* when a technical or design decision helps or harms them, and to route the trade-off to the Product Manager / Growth Strategist / CEO. Commercial blindness is a defect, not someone else's job.

---

## Model tier map

Rules, plans, and agent prompts reference **tiers**, never model names — this table is the only place the tier→model binding lives. A model-generation change is a one-line edit here, not a sweep across rules and plan YAMLs.

| Tier | Current model | Used for |
|---|---|---|
| `top` | Opus | Architect gates, security-tier reviews, `security-reviewer` default |
| `mid` | Sonnet | REVIEW verdict floor, RED/GREEN/REFACTOR default, `code-reviewer` default |
| `cheap` | Haiku | Mechanical sweeps only — file inventories, lint-style checks. Never REVIEW verdicts, never architect gates (cheap-tier reviewers fabricate findings; the hallucination guard exists because of them) |

A REVIEW verdict produced below `mid` is non-compliant. Fable (the tier above Opus) exists but is not adopted — cost; re-evaluate when pricing changes.

---

## Agent file schema

Every agent in `.claude/agents/` follows this structure so the system reads coherently:

- **Frontmatter** — `name` (Title Case), `description` (third-person; role + authority + what they own, ending with one `Use when …` routing clause — the subagent router sees only the description, never the body), `color`, `emoji`, `vibe` (one line), `tools` (the shared line; reviewers drop `Edit`/`Write` so review-only is mechanical, not prose). No `model` field, with two exceptions pinned per the [Model tier map](#model-tier-map): `code-reviewer` (`sonnet`) and `security-reviewer` (`opus`).
- **Lifecycle banner** — a one-line blockquote pointing here: operates in this lifecycle; the Research + Commercial standards are binding.
- **Identity & Priors** — one-line essence + a short list of hard-won priors (the judgment heuristics that keep the agent from repeating known mistakes). Light persona, no theatrics.
- **Primary Role & Authority** — what they decide and are final on; an explicit "you do NOT own" boundary.
- **Phase Alignment** — table of which phases they contribute to and how.
- **Invoke When** — concrete triggers.
- **Required Inputs / Expected Outputs** — the contract.
- **Domain Research Notes** — only the *domain-specific* axes on top of the Mandatory Research Standard (don't restate the generic axes).
- **Templates & References** — pointers to `docs/templates/` for owning agents.
- **Collaboration & Handoffs** — one agent-keyed table (`| Agent | Collaboration & handoff | Escalate / gate |`) covering the standing relationship, the artifact handed each way, and the escalation trigger per agent — so each relationship appears once. Process-level **Review** and **Feedback loop** bullets sit below the table.
- **Quality Standards You Enforce / Avoid / Communication Contract.**

Keep the generic lifecycle, research, and commercial content *here* — agents reference it, never restate it. Changing the lifecycle means editing this file, not 24 agents.
