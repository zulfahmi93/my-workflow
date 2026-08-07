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
export const FORBIDDEN_TOOLS = {
  'code-reviewer.md': ['Edit', 'Write', 'NotebookEdit'],
  'finding-verifier.md': ['Edit', 'Write', 'NotebookEdit'],
  'security-reviewer.md': ['Edit', 'NotebookEdit'],
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
