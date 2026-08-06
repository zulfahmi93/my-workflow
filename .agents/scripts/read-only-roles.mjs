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
