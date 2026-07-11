---
name: autonomous-run
description: >
  Executes an authorized contiguous range of plan cycles without per-cycle check-ins,
  committing once per completed cycle — the only sanctioned exception to never-auto-commit.
  Preflights the three authorization conditions and every in-range architect-gate field,
  loops the cycle procedure with one commit per cycle, and halts on any protocol stop
  condition by writing AUTONOMOUS_RUN_STATUS.md. Use when the user says "autonomous run",
  "run cycles X→Y autonomously with auto-commit", or invokes the autonomous-run skill.
---

# Claude Code adapter

Read `.agents/skills/autonomous-run/SKILL.md` in full and follow it as the canonical skill.
