---
name: tdd
description: >
  Strict red-green-review-refactor-commit TDD cycle. Enforces test-first development by gating
  each phase: RED (failing test that fails for the right reason), GREEN (minimal code to pass),
  REVIEW (independent reviewer gate — APPROVED or NEEDS FIX), REFACTOR (apply review notes
  while tests stay green; loops back to REVIEW), COMMIT (terminal state — emit message draft,
  await user confirmation). Delegates to agents — Test Engineer drafts tests, the stack Expert
  writes implementation, Code Reviewer guards the gate. Enforces a strict NO DEFER policy on
  review findings. Use when the user says "tdd this", "red-green", "write a failing test first",
  "test-drive", or invokes the tdd skill. Auto-trigger when the user asks to add a new function/class/
  endpoint and mentions tests upfront.
---

# Claude Code adapter

Read `.agents/skills/tdd/SKILL.md` in full and follow it as the canonical skill.
