# Cycle-to-commit workflow

Canonical vendor-neutral contract for taking one plan cycle all the way to commit-ready in
an isolated worktree. Wraps [the TDD cycle workflow](tdd-cycle.md) rather than replacing it.

It exists because the TDD cycle approves at zero `BLOCKER` and zero `REFACTOR` findings, so
`NIT`s survive approval by design. When a run must leave nothing open — however small — the
cycle needs a closing stage the TDD cycle deliberately does not have.

## Inputs

Required: `project`, `projectPath`, `plan`, `cycle`, `greenRole`.

Optional: `redRole`, `securityTier`, `maxCloseRounds` (default 3), runtime tier mappings,
and `extraNotice` — appended to the isolation preamble.

`projectPath` must be a dedicated git worktree for this cycle, not the project's primary
checkout. That is the whole premise: sibling cycles run concurrently in their own trees.

## Global invariants

- The isolation preamble reaches **every** delegate, including read-only ones. A verifier
  that runs the gate command in the wrong tree judges code the cycle does not own.
- Delegates never commit, branch, create cycle notes, or touch any cycle's `status:`.
  The orchestrator owns all of that.
- The workflow reports commit-readiness. It never commits and never pushes.
- The child TDD cycle is invoked by **path**, resolved relative to this adapter. Name-based
  resolution serves the copy registered when the session began, so a mid-session edit to
  the adapter would be silently ignored.

## Sequence

### 1. Cycle

Run the full TDD cycle child workflow against the worktree, passing the isolation preamble
as its `notice`. Any halt from the child is returned unchanged — a child failure is never
converted into readiness.

### 2. Close

Collect the surviving findings from **every** review pass and the security review, not only
the approving pass: a finding raised early that the final reviewer did not restate would
otherwise ship open, which is the exact gap this workflow closes. Dedupe on tag, file and text.

Then loop up to `maxCloseRounds` rounds of close-then-verify:

- **Close by class, not by cited instance.** Fixing only the lines a reviewer happened to
  cite leaves the rest of the same defect in place. Each class carries a mechanical
  enumeration command and a match count, so the sweep is checkable rather than asserted.
- **Close untested values by mutation** — change the value, watch the suite fail, restore.
  Never add an assertion you have not seen fail.
- **A finding may be rejected only with refuting command output.** Disagreement is not
  refutation.

### 3. Verify

An independent delegate holding no closing context re-runs each enumeration command, adds
at least one of its own, and mutates pinned values itself. It reports `dry` only when it
finds nothing open.

Stop with `close-rounds-exhausted` when the rounds run out with findings still open. That is
a convergence failure and belongs to a human — passing it to the gate as an opinion is how
"nothing ships open" quietly becomes "the last reviewer was comfortable".

### 4. Gate

A fresh reviewer that has seen none of the closing work confirms its working directory from
`pwd`, lists the files in the diff from the worktree's own status, runs the suite itself,
and decides `commitReady`. Legitimate outcomes include tracked follow-ups explicitly owned
by a named later cycle.

## Output

On success: the child cycle's full record plus the close rounds, the gate verdict, and
`commitReady` — true only when the gate says so **and** it raised no findings of its own.
The orchestrator then files the cycle note with the complete review-pass roster, updates
plan status, and commits.

On halt: a stable `halted` code and enough structured state to write a status handoff.

Halt codes: `tdd-cycle-died`, `closer-died`, `verifier-died`, `commit-gate-died`,
`close-rounds-exhausted`, plus any code propagated from the child cycle.

Claude Code's executable adapter is `.claude/workflows/cycle-to-commit.js`.
It maps the neutral `greenRole` / `redRole` names to its legacy `greenAgent` / `redAgent`
argument keys.
