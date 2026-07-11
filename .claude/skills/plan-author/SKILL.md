---
name: plan-author
description: >
  Authors a new single-source plan-NNN.yaml for a project and onboards it to the docs
  generator: cycles with architect-gate fields, batches / critical-path / file-ownership
  graph data, runbook and overview prose, registry + site-config entries, then the
  validate-and-build gate with inferred graph edges reported for human review. Use when
  the user says "author plan NNN for <project>", "new plan", "write the next plan", or
  invokes the plan-author skill.
---

# Claude Code adapter

Read `.agents/skills/plan-author/SKILL.md` in full and follow it as the canonical skill.
