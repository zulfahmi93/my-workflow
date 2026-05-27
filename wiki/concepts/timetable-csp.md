---
name: timetable-csp
description: Timetable scheduling as a Constraint Satisfaction Problem; OR-Tools CP-SAT engine + independent verifier pattern. Used by [[susun-jadual]].
metadata:
  type: concept
  used_by: [susun-jadual]
  last_ingested: 2026-05-19
---

# Timetable scheduling as a CSP

## One-line summary

A school timetable is a **Constraint Satisfaction Problem (CSP)**: assign a `(subject, teacher)` to each `(class, day, period)` cell while satisfying hard constraints (must hold) and minimising a weighted sum of soft-constraint penalties. LLMs cannot do this reliably; a deterministic solver (Google OR-Tools CP-SAT) can. Used by [[susun-jadual]].

## Model

### Decision variable

For each tuple `(class, day, period)`, choose a `(subject, teacher)` pair — or `null` (free slot).

Encoding (architect locks per cycle in `plan-001.yaml` `open-questions` #2):
- Boolean `assigned[class, day, period, subject, teacher] ∈ {0,1}` with exactly-one constraints, **OR**
- Integer `subject_at[class, day, period]` + `teacher_at[class, day, period]` with channelling.

### Hard constraints (`AddBoolOr` / `AddExactlyOne` / `Add` in CP-SAT)

| # | Rule | Why |
|---|---|---|
| H1 | At most one `(subject, teacher)` per `(class, day, period)` | Class can't do 2 things at once |
| H2 | At most one assignment per `(teacher, day, period)` | Teacher can't be in 2 places |
| H3 | At most one assignment per `(room, day, period)` (when room-bound) | Room can't host 2 classes |
| H4 | `count(class, subject) == period_allocations[class][subject]` over the week | Curriculum hours satisfied |
| H5 | `teacher ∈ qualified_for(subject)` | No physics teacher teaching art |
| H6 | `min_load[t] ≤ count(t) ≤ max_load[t]` | Teacher load bounds |
| H7 | `(t, d, p) ∈ unavailable[t]` ⇒ no assignment | Admin duty, part-time |
| H8 | `requires_lab(subject)` ⇒ assigned room is a compatible lab | Sci/computer/music subjects |
| H9 | `(d, p) == assembly` ⇒ no subject assignment | Mon assembly slot non-movable |
| H10 | `(d, p) == recess` ⇒ no assignment | Same; soft would let through |
| H11 | Parallel Islam ⊥ Moral: same slot, two teachers, two subjects | M'sia school religious split |

### Soft constraints (penalty variables; minimise `sum(weight_i × penalty_i)`)

| # | Rule | Default weight |
|---|---|---|
| S1 | PE not in last period | 5 |
| S2 | Math not immediately post-recess | 3 |
| S3 | > 3 consecutive teaching periods per teacher | 10 each |
| S4 | Same subject same class on consecutive days | 2 |
| S5 | Teacher daily-load imbalance (max-min day > 2) | 1 per period over |

Weights from `projects/susun-jadual/docs/research-report.md §3.6`. Externalised in request schema; user-overridable per plan-002.

### Output

For each `(class, day, period)`: assigned `(subject, teacher, room?, is_recess, is_assembly, parallel_partner_id?)` — or `null`.

## Why this shape

### Why CSP, not LLM

- LLMs sample token-by-token; cannot guarantee no-teacher-conflict across 30 classes × 8 periods × 5 days = 1,200 cells.
- Empirically: even frontier LLMs (Gemini 3.x, Opus 4.x as of May 2026) produce conflict-ridden schedules for >4 classes. Hallucinated teacher assignments are common.
- Provability matters: a school timetable is binding for 6+ months. Liability + customer trust collapse on quiet conflicts.
- LLMs do have a role — **natural-language → constraint extraction** at the input boundary (plan-002). Validated server-side; rejected if ambiguous.

### Why OR-Tools CP-SAT

- **Apache 2.0 licence** — commercial SaaS-safe. (FET is excellent but AGPL forces source disclosure.)
- **Battle-tested for educational timetabling.** XHSTT (International Timetabling Competition, 2014 archive): CP-SAT beat dedicated timetabling engines on multiple instances.
- **Python bindings first-class.** Modelling is declarative; solving runs in optimised C++.
- **Multi-threaded search; presolve; LNS (Large Neighbourhood Search) built-in.** Recovers fast from infeasible regions.
- **Streaming progress callback.** `model.NewProgressCallback()` exposes best-objective + nodes-explored counters as search runs — feeds web progress UI without extra polling.

### Why an independent verifier

Solvers are fast; trusted solvers are dangerous. Every cycle that touches the solver ships a separate `verify.py` that walks the result and re-checks all hard constraints from scratch. The verifier **does not import the solver's own check helpers** — it is independent ground truth. Reviewer flags any cycle that lacks the verifier or that has the verifier sharing code with the solver as `[BLOCKER]`. Pattern is borrowed from formal-verification practice.

### Infeasibility-as-first-class

Infeasibility is not an error — it is a user-actionable result. When CP-SAT returns UNSAT, the solver service must return:

```json
{
  "status": "infeasible",
  "infeasibility_hint": ["teacher_AHMAD_load_bound", "PI_PM_parallel_split_room_conflict"]
}
```

…via `model.SufficientAssumptionsForInfeasibility`. The web UI then renders these as a "relax one of these" suggestion list with deep-links to the editing pages.

## Authoritative spec

- `projects/susun-jadual/docs/research-report.md §2–§3` — full taxonomy + solver feasibility benchmarks.
- `projects/susun-jadual/docs/plan-001.yaml` — cycles 2.1–2.4 (`solver` phase) that implement the model.
- Furst et al. 2018, "XHSTT-2014 archive results," International Timetabling Competition.
- Google OR-Tools docs, https://developers.google.com/optimization/cp/cp_solver.

## Implementation refs

(Empty at plan-001 launch. Populated as cycles 2.1–2.4 ship.)

- `services/solver/model.py` — CP-SAT model (Cycle 2.2)
- `services/solver/verify.py` — independent verifier (Cycle 2.2)
- `services/solver/schemas.py` — Pydantic request / response (Cycle 2.1)
- `services/solver/tests/fixtures/` — tiny / small / typical benchmark fixtures (Cycle 2.4)
