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

# Autonomous run

Implements
[cycle-orchestration.md §Autonomous run protocol](../../rules/cycle-orchestration.md#autonomous-run-protocol)
verbatim — authorization, per-cycle obligations, stop conditions, STATUS format, resume
rules all live there. Autonomy never relaxes a gate.

## Procedure

1. **Preflight — all of this before cycle 1:**
   - Verify the THREE authorization conditions per the protocol's §Authorization:
     explicit cycle range, explicit commit grant, session scope. Any missing → ask the
     user; never infer authorization.
   - Verify EVERY in-range cycle carries its `Architecture review:` (`arch-review`) field
     in the plan YAML — this preflights stop condition 2 so the run doesn't die
     mid-range. Security-tier cycles must already show the top-tier gate (stop
     condition 3).
   - Confirm the working tree is clean (`git status`) — each cycle's commit must be a
     bounded diff.

2. **Loop per cycle, in range order:**
   - Run the full cycle procedure (the [cycle skill](../cycle/SKILL.md)): architect
     gate, RED → GREEN → REVIEW → (REFACTOR → REVIEW)*, then Definition of done (1)–(8).
   - Then COMMIT per [commit.md](../../rules/commit.md): one cycle = one commit, bounded
     to the cycle's code + plan `status:` + cycle note. This is the sanctioned exception
     — the grant was verified in preflight.

3. **Stop conditions.** Honor the protocol's
   [§Stop conditions](../../rules/cycle-orchestration.md#stop-conditions--halt--write-status)
   1–8 verbatim. On ANY hit: halt immediately and write
   `<project>/docs/AUTONOMOUS_RUN_STATUS.md` in the protocol's §STATUS file format
   (plan + authorized range, one line per completed cycle with its SHA, halted cycle +
   phase, the numbered stop condition, verbatim evidence, proposed next action). The run
   never resumes itself — the user reviews, resolves, and re-authorizes the remaining
   range.

4. **End-of-run summary**: cycles completed with commit SHAs, plus anything tracked into
   the plan's §Cycle follow-ups during the run.

5. **Never, even when authorized**: push, open PRs, `--amend`, `--no-verify`, force
   operations, or commits outside the cycle's bounded diff.
