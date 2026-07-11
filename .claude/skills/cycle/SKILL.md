---
name: cycle
description: >
  Orchestrates one plan-driven TDD cycle end-to-end per cycle-orchestration.md: architect-gate
  check from the plan YAML, RED → GREEN → REVIEW → (REFACTOR → REVIEW)* via the plan's
  per-cycle agent and model-tier assignments, then the full Definition-of-done walk (plan
  status update, validated cycle note, docs-site regen) — stopping short of commit. Use when
  the user says "begin cycle X.Y", "run cycle X.Y", "do cycle X.Y of plan NNN", or invokes
  the cycle skill by name.
---

# Claude Code adapter

Read `.agents/skills/cycle/SKILL.md` in full and follow it as the canonical skill.
