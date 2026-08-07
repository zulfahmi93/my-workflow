// Roles whose Codex adapter gets `sandbox_mode = "read-only"`, and whose Claude adapter
// carries no `Edit`/`Write` in its tools line.
//
// Single source deliberately: the generator and the validator both need this list, and when
// each kept its own copy the validator's byte-compare re-derived the policy instead of
// checking it — adding a role to one and not the other would have produced a "generated
// adapter is stale" error pointing at the adapter rather than at the real cause.
//
// The Claude side of the same policy (the `tools:` line) is NOT derivable here: sync
// preserves tools/model from the existing adapter rather than generating them, so a new
// read-only role needs its tools line set by hand. Verify with the check below.
//
// KEEP THIS A LITERAL ARRAY OF QUOTED STRINGS. It has a second consumer that is not
// JavaScript: check-read-only-command.py parses this declaration textually, because the
// PreToolUse hook is Python (the sibling policy scripts are, and python3 is already the
// hard dependency) and cannot import an .mjs. Computing the list — spreading another
// constant, mapping over a directory read — would still satisfy every JS consumer while
// the Python parse silently fell back to "no roles are read-only", which fails OPEN and so
// looks exactly like a gate with nothing to block. Adding a role is one more quoted line.
export const READ_ONLY_ROLES = [
  'code-reviewer.md',
  'finding-verifier.md',
  'security-reviewer.md',
];

// Claude-side counterpart, per role, because the three are NOT equivalent and flattening
// them would silently strip a capability one of them needs:
//   code-reviewer    — no write of any kind. "Your toolset carries no edit access, so the
//                      review stays a review" (.agents/roles/code-reviewer.md).
//   finding-verifier — same, and stricter in kind: a verifier that repairs the thing it was
//                      asked to check makes its own `refuted: true` true.
//   security-reviewer— keeps Write: it files the threat model that cycle-orchestration.md
//                      §Security tier REQUIRES in the cycle note. It still must not Edit,
//                      because editing the diff would make it the diff's co-author.
//
// `Agent` is denied to all three. It is a write channel by proxy: a reviewer holding it can
// spawn `general-purpose`, which HAS Edit, and the spawned agent carries its OWN
// `agent_type`, so check-read-only-command.py below sees a general-purpose call and lets it
// through. Nothing in .agents/rules/ or the role files asks a reviewer to spawn anything —
// collaboration routes through the orchestrator — so this costs the roles nothing.
//
// `Skill` is deliberately NOT denied. A skill grants no tool the agent does not already
// hold, so with Edit/Write gone and Bash gated it is not a write channel; denying it would
// remove real review tooling for no enforcement gain. Denying a tool that cannot write is
// how an allowlist starts looking like security theatre.
export const FORBIDDEN_TOOLS = {
  'code-reviewer.md': ['Agent', 'Edit', 'Write', 'NotebookEdit'],
  'finding-verifier.md': ['Agent', 'Edit', 'Write', 'NotebookEdit'],
  'security-reviewer.md': ['Agent', 'Edit', 'NotebookEdit'],
};

// What "read-only" actually means for this family, and how much of it is MECHANICAL.
//
// It was prose. FORBIDDEN_TOOLS denies the file-editing tools, but all three roles keep
// `Bash`, and Bash is a complete write channel — measured through both PreToolUse hooks as
// they stood: `printf "" > .agents/roles/code-reviewer.md` as a Code Reviewer exited 0, and
// so did `sed -i "" s/x/y/ src/pay.ts` as a Finding Verifier. The allowlist said read-only;
// the terminal was not.
//
// Bash cannot just be removed. The Code Reviewer's own standard is "quote the gate result
// (`Passed: N / Failed: 0`) or run the stated test command yourself", so the role needs a
// shell to do its job at all. The enforceable boundary is therefore not "no shell" but no
// shell WRITE INTO THE WORKING TREE — `.agents/scripts/check-read-only-command.py`, wired
// as a Claude PreToolUse(Bash) hook.
//
// AGENT_IDENTITY_EVIDENCE — why per-role hook enforcement is buildable at all, recorded
// because the honest alternative was to declare it unbuildable and downgrade the invariant
// to prose. Measured 2026-08-07 against Claude Code 2.1.223, by dumping real payloads from
// throwaway sessions (`--settings`/`--agents` inline JSON, a hook that just `cat >>`s):
//   · The PreToolUse payload's base fields carry `agent_id` and `agent_type`. The runtime's
//     own schema: agent_type is "Present when the hook fires from within a subagent
//     (alongside agent_id), or on the main thread of a session started with --agent".
//   · Dumped subagent Bash call → `agent_type: "probe-reviewer"`, the agent's own name.
//     Dumped MAIN-THREAD Bash call → both fields absent. So the gate is inert for the
//     orchestrator and fires only inside a subagent, with no opt-out to configure.
//   · The path that matters is the workflow, not a bare Task call: tdd-cycle.js dispatches
//     `agentType: 'Code Reviewer'`. Dumped from a real workflow `agent()` step against an
//     adapter declaring `name: Echo Checker` → `agent_type: "Echo Checker"`, NOT the
//     built-in `workflow-subagent`. Identity survives the workflow dispatch, so the gate
//     covers the review passes it exists for.
//
// What is mechanical, per runtime, stated exactly so nothing here overclaims:
//   Codex  — fully. sync-codex-adapters.mjs writes `sandbox_mode = "read-only"` for every
//            role listed above; the runtime denies the write, no command inspection.
//   Claude — Edit/Write/NotebookEdit/Agent by allowlist (validate-agent-config.mjs), and
//            repo-tree writes via Bash by the hook. NOT total: the hook resolves the write
//            positions it can (redirects, tee/cp/mv/rm/sed -i, `bash -c`/`eval` payloads)
//            and deliberately skips words carrying shell expansion, because a false block
//            stops a real review. A determined agent can still write through a shape the
//            lexer cannot resolve statically. This raises the cost of an accidental or
//            casual write from zero to deliberate; it is not a sandbox.
export const READ_ONLY_ENFORCEMENT = {
  codex: 'sandbox — sandbox_mode = "read-only" on every adapter',
  claude: 'tools allowlist + PreToolUse(Bash) repo-write gate keyed on agent_type',
};

// Tier floor for the same family, for the same reason `tools:` needed one: sync preserves the
// adapter's `model:` line from disk rather than deriving it, so nothing re-checks it after the
// first write. Measured: setting `.claude/agents/code-reviewer.md` to `model: haiku` left both
// validate-agent-config.mjs and test-agent-config.mjs byte-identical in output and exit code —
// the field the review family's compliance rests on was validated by nothing at all.
//
// Semantic tiers per .agents/rules/lifecycle.md §Model capability tiers, floors per role because
// the three genuinely differ and a flat `top` would over-constrain the verifier:
//   code-reviewer    — `top`. cycle-orchestration.md §Hallucination guard: "REVIEW runs at `top`
//                      regardless"; tdd-cycle.js dispatches the REVIEW pass at MODELS.top.
//   security-reviewer— `top`. lifecycle.md reserves `top` for security-tier reviews, and the
//                      security second pass in tdd-cycle.js runs at MODELS.top.
//   finding-verifier — `mid`. tdd-cycle.js runs the refutation pass at MODELS.mid, so the
//                      adapter's `sonnet` is correct, not a floor violation to be raised away.
export const MINIMUM_TIER = {
  'code-reviewer.md': 'top',
  'finding-verifier.md': 'mid',
  'security-reviewer.md': 'top',
};

// Comparable ranks for MINIMUM_TIER, carrying lifecycle.md's legacy-alias bridge (`opus` IS `top`,
// `sonnet` IS `mid`) so a consumer does not re-derive it and drift — the same reason READ_ONLY_ROLES
// is single-sourced above. Anything absent ranks 0 and so fails every floor, which is what catches
// the retired `haiku` / `cheap` tokens and a typo'd model name with one comparison instead of a
// denylist that has to be kept in step with the tiers that no longer exist.
export const TIER_RANK = { top: 2, opus: 2, mid: 1, sonnet: 1 };

// Consumed by validate-agent-config.mjs, immediately after the FORBIDDEN_TOOLS block, which is
// where the adapter's `model:` line is already in hand. Both maps must stay data-only here: this
// file is imported by the validator, so a check written INTO it would validate nothing until
// something called it — the exact "documents policy without enforcing it" state it exists to
// prevent, and the state these two maps sat in until the consumer landed.
