export const meta = {
  name: 'tdd-cycle',
  description: 'One plan-driven TDD cycle: architect gate → RED → GREEN → REVIEW/(verify→REFACTOR→REVIEW)* with schema-validated verdicts',
  whenToUse: 'User opts into workflow execution of a plan cycle (e.g. "run cycle 4.2 with the workflow"). Returns a structured record the orchestrator files into the cycle note + plan status. Commits stay outside the workflow.',
  phases: [
    { title: 'Gate', detail: 'read plan cycle entry; architect verdict if required' },
    { title: 'RED', detail: 'failing test that fails for the right reason' },
    { title: 'GREEN', detail: 'minimal implementation to pass' },
    { title: 'REVIEW', detail: 'independent verdict + adversarial verification of findings' },
    { title: 'REFACTOR', detail: 'resolve confirmed findings; loop to REVIEW' },
  ],
}

// Required args: { project, projectPath, plan, cycle, greenAgent }
// Optional: redAgent (default 'Test Engineer'), securityTier (bool), models ({top, mid} override),
//           maxReviewPasses (default 6, productive passes only), maxRefutedOnlyPasses (default 3),
//           notice (extra text appended to every delegate's preamble — e.g. an isolation warning
//           when projectPath points at a git worktree rather than the project's primary checkout)
//
// `args` can arrive as a JSON STRING rather than an object (reproduced: a payload passed to a
// name-based invocation reaches the script as a string, so every A.<key> read is undefined and the
// required-args loop below fails with a misleading "args.project is required"). Normalize instead
// of making callers wrap the call.
const A = normalizeArgs(args)

function normalizeArgs(raw) {
  if (typeof raw !== 'string') return raw || {}
  try {
    return JSON.parse(raw) || {}
  } catch {
    throw new Error(`args arrived as a non-JSON string: ${raw.slice(0, 80)} — pass an object, e.g. { project: "…", cycle: "4.2" }`)
  }
}
// Accept the neutral spec's greenRole/redRole alongside the legacy greenAgent/redAgent
// keys. Following .agents/workflows/*.md verbatim used to fail on a required-arg check.
if (A.greenRole && !A.greenAgent) A.greenAgent = A.greenRole
if (A.redRole && !A.redAgent) A.redAgent = A.redRole
for (const k of ['project', 'projectPath', 'plan', 'cycle', 'greenAgent']) {
  if (!A[k]) throw new Error(`args.${k} is required — e.g. { project: "isc-workflow-web", projectPath: "projects/rintis/isc-workflow-web", plan: "004", cycle: "4.2", greenAgent: "React Expert" }`)
}

const RULES = '.agents/rules'
// Claude-specific tier→model binding for .agents/rules/lifecycle.md §Model capability tiers. That rule
// has exactly two tiers — `top` (architect gate, REVIEW, security review) and `mid` (RED, GREEN,
// REFACTOR, finding-verifier) — and no third, cheaper one. This loop is what makes "the adapter
// binds { top, mid } and rejects any other tier key" true rather than merely asserted.
//
// The spread is the documented override channel, and it was trusted with no validation, which made
// it the way a non-compliant binding got in silently. Rendered against stubbed globals (the
// renderCycle technique in .agents/scripts/test-agent-config.mjs), two overrides reached `agent()`
// without a complaint: `{ top: undefined }` beat the default — spread copies an own key even when
// its value is undefined — and handed `model: undefined` to BOTH the architect gate and the REVIEW
// gate; and `{ top: 'haiku' }` bound both to the cheap tier. lifecycle.md is explicit that a REVIEW
// verdict produced below `mid` is non-compliant and that architect gates are top-tier only. Neither
// case fails at the call site — the delegate just runs on whatever the harness defaults to — so the
// verdict comes back looking exactly like a compliant one. Fail loudly at the binding instead.
const MODELS = { top: 'opus', mid: 'sonnet', ...(A.models || {}) }
const CHEAP_ALIASES = new Set(['cheap', 'haiku', 'claude-haiku'])
for (const [tier, model] of Object.entries(MODELS)) {
  if (tier !== 'top' && tier !== 'mid') {
    throw new Error(`args.models.${tier} is not a tier this workflow binds — pass only { top, mid }. Per ${RULES}/lifecycle.md §Model capability tiers there is no third, cheaper tier; the mechanical work that used to justify one runs at \`mid\`.`)
  }
  if (typeof model !== 'string' || !model.trim()) {
    throw new Error(`args.models.${tier} must be a non-empty model name, got ${JSON.stringify(model)} — omit the key to keep the default (top: opus, mid: sonnet).`)
  }
  if (CHEAP_ALIASES.has(model.trim().toLowerCase())) {
    throw new Error(`args.models.${tier} = ${JSON.stringify(model)} binds a below-\`mid\` model to \`${tier}\`. Per ${RULES}/lifecycle.md §Model capability tiers \`mid\` is the floor — a REVIEW verdict produced below it is non-compliant — and architect gates are top-tier only.`)
  }
}
const RED_AGENT = A.redAgent || 'Test Engineer'
const PLAN_PATH = `${A.projectPath}/docs/plan-${A.plan}.yaml`
// 4 was too low for a large cycle. Cycle 8.3 (plan-008) converged 7 → 5 → 2 → 2 blocking
// findings across four passes with zero hallucinations rejected, then halted on the cap with two
// documentation findings outstanding — a stop that read as "reviewer dispute" when the cycle was
// plainly still converging. Raise the ceiling rather than teach the orchestrator to override the
// stop condition, and let the caller lower it for small cycles.
const MAX_REVIEW_PASSES = A.maxReviewPasses || 6

const COMMON = `Project: ${A.project}. Working dir is the repo root.
Read before acting: ${PLAN_PATH} (cycle ${A.cycle} entry only), the nearest local guide under ${A.projectPath} (AGENTS.md preferred; legacy CLAUDE.md allowed), ${RULES}/tdd.md, ${RULES}/cycle-orchestration.md §Subagent prompt skeleton.
Tone: write idiomatic code/tests/docs (caveman is chat-only and does not apply to subagents).
NO-DEFER: every [BLOCKER]/[REFACTOR] finding is resolved this cycle (${RULES}/tdd.md §Deferral policy).
Out of bounds unless the cycle spec says otherwise: package additions, schema edits, API-contract changes, editing tests during GREEN.${A.notice ? `\n${A.notice}` : ''}`

// The finding-verifier is READ-ONLY, so it must not inherit COMMON's implementer clauses —
// a refuter told "NO-DEFER: every finding is resolved this cycle" is being pointed at the
// opposite of its job. It does need the environment half, above all A.notice: that is the
// only channel a wrapper workflow uses to relocate the working dir (cycle-to-commit.js
// passes its worktree assertion through it), and a verifier running the gate command in the
// wrong tree refutes findings against the wrong code — the exact failure that wrapper was
// written after. Previously this prompt was standalone and hardcoded "cwd = repo root",
// so it was the one delegate isolation could never reach.
const VERIFY_COMMON = `Project: ${A.project}. Working dir is the repo root.${A.notice ? `\n${A.notice}` : ''}
You are read-only: run commands and read files, but never edit, create, commit, or branch.`

const GATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['mode', 'specSummary', 'securityTier', 'noTdd', 'lockedDecisions'],
  properties: {
    mode: { type: 'string', enum: ['required', 'deferred', 'none', 'missing'] },
    reason: { type: 'string' },
    reviewer: { type: 'string' },
    specSummary: { type: 'string' },
    securityTier: { type: 'boolean' },
    noTdd: { type: 'boolean' },
    lockedDecisions: { type: 'array', items: { type: 'string' } },
  },
}

const ARCH_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'summary', 'lockedDecisions'],
  properties: {
    verdict: { type: 'string', enum: ['GO', 'NO-GO'] },
    summary: { type: 'string' },
    lockedDecisions: { type: 'array', items: { type: 'string' } },
  },
}

const RED_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['testFiles', 'failingCommand', 'failureLine', 'gateResult'],
  properties: {
    testFiles: { type: 'array', items: { type: 'string' } },
    failingCommand: { type: 'string' },
    failureLine: { type: 'string' },
    gateResult: { type: 'string' },
  },
}

const IMPL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['filesTouched', 'gateResult', 'command', 'deviations'],
  properties: {
    filesTouched: { type: 'array', items: { type: 'string' } },
    gateResult: { type: 'string' },
    command: { type: 'string' },
    deviations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['change', 'rationale'], properties: { change: { type: 'string' }, rationale: { type: 'string' } } } },
    notes: { type: 'string' },
  },
}

const REFACTOR_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['filesTouched', 'gateResult', 'command', 'deviations', 'resolutions'],
  properties: {
    ...IMPL_SCHEMA.properties,
    resolutions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['finding', 'resolution'], properties: { finding: { type: 'string' }, resolution: { type: 'string' } } } },
  },
}

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'findings', 'skippedCategories'],
  properties: {
    verdict: { type: 'string', enum: ['APPROVED', 'NEEDS_FIX'] },
    findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['tag', 'finding', 'evidence'], properties: {
      tag: { type: 'string', enum: ['BLOCKER', 'REFACTOR', 'NIT'] },
      finding: { type: 'string' },
      // The command + output the reviewer actually ran to establish this finding. Required
      // on every finding so the verifier re-runs ONE quoted command instead of re-deriving
      // the whole claim, and so a reviewer cannot assert a defect it never observed. The two
      // recorded false BLOCKERs in this repo (isc 1.8, kobu 005.3) were both wrong-baseline
      // errors that a stated command would have exposed at authoring time.
      evidence: { type: 'string' },
      file: { type: 'string' },
      line: { type: 'number' },
      expectedRemediation: { type: 'string' },
    } } },
    skippedCategories: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['category', 'reason'], properties: { category: { type: 'string' }, reason: { type: 'string' } } } },
  },
}

// One verifier per PASS, not per finding: the per-finding fan-out paid a fresh context and
// often a fresh gate run for every claim (cycle 8.3 spent 7+5+2+2 = 16 verifier agents), and
// every refutation this repo has recorded was a self-contained single-claim check that gains
// nothing from being isolated from its siblings. `verdicts` is index-aligned with the
// blocking findings it was given, and the count is checked before any of it is trusted.
const REFUTE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['index', 'refuted', 'evidence'],
        properties: {
          index: { type: 'number' },
          refuted: { type: 'boolean' },
          evidence: { type: 'string' },
        },
      },
    },
  },
}

// ---- Gate ----
phase('Gate')
const gate = await agent(`${COMMON}

Task: read ${PLAN_PATH} and extract cycle ${A.cycle}.
1. Read the cycle's "arch-review" mapping and return its "state" (required / deferred / none) as mode. Only if the cycle carries no "arch-review" key at all, look for a legacy prose "Architecture review:" line in the cycle's body before concluding mode = "missing".
2. If mode is deferred, the sibling is the cycle's "arch-review.deferred-to". Read that cycle's architect-verdict from ${A.projectPath}/docs/cycles/<X.Y>.yaml and return its locked-decisions as lockedDecisions (otherwise lockedDecisions = []).
3. specSummary: the cycle's spec in ≤ 200 words (title, phase steps, gate criteria, files in scope).
4. securityTier: the cycle's "security-tier" field (absent → false), OR true if the spec touches any item in ${RULES}/cycle-orchestration.md §Security tier.
5. noTdd: the cycle's "no-tdd" field, verbatim (absent → false). Report what the plan says; do not infer it from the spec.
Return data only.`, { label: 'gate:read-plan', phase: 'Gate', schema: GATE_SCHEMA })
if (!gate) throw new Error('gate reader died')

if (gate.mode === 'missing') {
  return { halted: 'architecture-review-field-missing', detail: `Cycle ${A.cycle} has no "arch-review" field in ${PLAN_PATH} (schema: plan.schema.json $defs.cycle requires it). Per cycle-orchestration.md §Architect gate: STOP and ask the user to mark the cycle in the plan.` }
}

const securityTier = Boolean(A.securityTier || gate.securityTier)
if (securityTier && gate.mode === 'none') {
  return { halted: 'security-tier-plan-mismatch', detail: 'Cycle is security-tier but the plan marks architecture review "none". Per §Security tier the plan field must be upgraded — ask the user.', gate }
}

let architectVerdict = null
if (gate.mode === 'required' || (securityTier && gate.mode !== 'deferred')) {
  const arch = await agent(`${COMMON}

You are the architecture gate for cycle ${A.cycle}.${securityTier ? ' SECURITY-TIER cycle — apply §Security tier scrutiny (threat surface, trust boundaries, secret handling).' : ''}
Cycle spec: ${gate.specSummary}
Verdict ≤ 400 words. GO or NO-GO. lockedDecisions: the decisions RED/GREEN must honor verbatim.`,
    { label: 'gate:architect', phase: 'Gate', schema: ARCH_SCHEMA, agentType: 'Software Architect', model: MODELS.top })
  if (!arch) throw new Error('architect died')
  architectVerdict = { verdict: arch.verdict, summary: arch.summary, lockedDecisions: arch.lockedDecisions, tier: 'top', mode: gate.mode }
  if (arch.verdict === 'NO-GO') return { halted: 'architect-no-go', architectVerdict, gate }
}

const locked = [...(gate.lockedDecisions || []), ...((architectVerdict && architectVerdict.lockedDecisions) || [])]
const lockedBlock = locked.length ? locked.map(d => `- ${d}`).join('\n') : '- none'

// A `no-tdd: true` cycle (docs, ADR sweeps, prose) has no behaviour to drive a failing test from.
// Forcing RED there produces a test written to fail on purpose, which is worse than no test: it
// passes the gate mechanically while asserting nothing. Skip RED and redefine REVIEW as a
// fact-check, where an unverifiable claim is a BLOCKER — that verification IS the gate for a
// docs cycle, since there is no suite result to stand in for it.
const noTdd = Boolean(gate.noTdd)

// ---- RED ----
let red = null
if (noTdd) {
  log(`no-tdd cycle — RED skipped; REVIEW runs as a source-verified fact-check`)
} else {
  phase('RED')
  red = await agent(`${COMMON}
Locked decisions:
${lockedBlock}
Cycle spec: ${gate.specSummary}

RED phase per ${RULES}/tdd.md: author the failing test(s) for this cycle. The test must fail for the RIGHT reason (missing/incorrect behavior — not a typo, import error, or broken infra), with a failure message naming the expectation. Run it and quote the exact failure line.`,
    { label: 'red', phase: 'RED', schema: RED_SCHEMA, agentType: RED_AGENT, model: MODELS.mid })
  if (!red) throw new Error('RED author died')
  log(`RED: ${red.failureLine}`)
}
const testFiles = (red && red.testFiles) || []

// ---- GREEN (or AUTHOR, for a no-tdd cycle) ----
phase('GREEN')
const green = await agent(`${COMMON}
Locked decisions:
${lockedBlock}
Cycle spec: ${gate.specSummary}
${noTdd
  ? `AUTHOR phase (no-tdd cycle — there is no RED report and you must not invent one).
Make exactly the documentation changes the cycle spec calls for. Every factual claim you write MUST be verified against current source before you write it: open the file, read the line, cite it. Where the spec's own description disagrees with what the source now says, the SOURCE wins — record the discrepancy in notes rather than propagating the spec's version.
Do not edit code or tests. Run the project's full test suite anyway and report it unchanged, so a stray edit cannot hide. gateResult format: "Passed: N / Failed: 0".`
  : `RED report: tests ${JSON.stringify(testFiles)}; failing with: ${red.failureLine}; command: ${red.failingCommand}

GREEN phase per ${RULES}/tdd.md: minimal code to flip the failing test(s) green. Do NOT edit the tests. Satisfy the full GREEN gate (whole suite green, zero new warnings, no debug residue, no untested branches) before returning. gateResult format: "Passed: N / Failed: 0".`}`,
  { label: noTdd ? 'author' : 'green', phase: 'GREEN', schema: IMPL_SCHEMA, agentType: A.greenAgent, model: MODELS.mid })
if (!green) throw new Error(`${noTdd ? 'AUTHOR' : 'GREEN'} implementer died`)
log(`${noTdd ? 'AUTHOR' : 'GREEN'}: ${green.gateResult}`)

// ---- REVIEW ⇄ REFACTOR ----
const reviewLog = []
const hallucinationsRejected = []
const refactors = []
let lastReport = green
// The review SCOPE accumulates; `lastReport` does not. Reassigning lastReport per pass also
// narrowed the file list handed to the next reviewer: a cycle whose GREEN wrote a..e and whose
// REFACTOR touched only `a` had its APPROVING pass told to review `a` alone, and then approved
// the whole cycle. The security reviewer had it worse — it runs after the loop, so it was
// permanently pointed at the last general refactor's files. Same bug class as `securityReviews`
// below: the newest report is the right gate result and the right command, never the right diff.
// Only filesTouched is cumulative.
const reviewScope = new Set(green.filesTouched)
// The degenerate case of the same defect: a reviewer handed [] has nothing to review and can
// only return APPROVED. GREEN cannot flip a failing test without touching a file, and a no-tdd
// AUTHOR cycle exists to change docs, so zero files is a broken report — not a real outcome.
if (!reviewScope.size) {
  return { halted: 'empty-review-scope', detail: `${noTdd ? 'AUTHOR' : 'GREEN'} reported filesTouched: [] — the reviewer would be handed an empty diff and could only approve. Re-run the phase, or fix the implementer's report if it did edit files.`, gate, architectVerdict, red, green }
}
let approved = false

// Three counters, because they bound different failures:
//   attempt         — every review invocation; drives labels and the reviewer-id convention.
//   productivePass  — a pass whose findings survived verification and drove a REFACTOR.
//                     Only these consume MAX_REVIEW_PASSES, which exists to bound genuine
//                     convergence (7 → 5 → 2 → 2). Previously a pass whose findings were ALL
//                     refuted still incremented it, so a hallucinating reviewer could burn
//                     the whole budget of `top`-tier passes and halt a cycle that had nothing
//                     wrong with it — the stop then read as "reviewer dispute".
//   refutedOnlyPass — bounded separately: not free, just not charged to the wrong budget.
let attempt = 0
let productivePasses = 0
let refutedOnlyPasses = 0
const MAX_REFUTED_ONLY = A.maxRefutedOnlyPasses || 3

while (!approved) {
  if (productivePasses >= MAX_REVIEW_PASSES) {
    return { halted: 'review-not-approved', detail: `NEEDS FIX after ${productivePasses} productive review passes — autonomous stop condition 5.`, gate, architectVerdict, red, green, reviewLog, refactors, hallucinationsRejected }
  }
  if (refutedOnlyPasses >= MAX_REFUTED_ONLY) {
    return { halted: 'reviewer-hallucination-loop', detail: `${refutedOnlyPasses} consecutive review passes produced only refuted findings. The reviewer is not converging on real defects; a human should read the rejected claims below.`, gate, architectVerdict, red, green, reviewLog, refactors, hallucinationsRejected }
  }
  attempt += 1
  const pass = attempt
  const guard = hallucinationsRejected.length
    ? `\nHallucination guard (${RULES}/cycle-orchestration.md §Reviewer hallucination guard): earlier passes produced findings that contradicted verified state. Verify paths with ls/grep and run the gate command BEFORE asserting anything is missing. Rejected claims + evidence:\n${hallucinationsRejected.map(h => `- "${h.claim}" — refuted: ${h.evidence}`).join('\n')}\nPrior gate result stands: ${lastReport.gateResult}.`
    : ''

  const review = await agent(`${COMMON}
You are the independent REVIEW gate (pass ${pass}) for cycle ${A.cycle}. Apply ${RULES}/review-checklist.md to the diff.
Files to review: ${JSON.stringify([...reviewScope])}${testFiles.length ? ` plus tests ${JSON.stringify(testFiles)}` : ''}
Cycle spec: ${gate.specSummary}
Locked decisions:
${lockedBlock}
Implementer gate result: ${lastReport.gateResult} (command: ${lastReport.command})${guard}
${noTdd
  ? `This is a no-tdd DOCUMENTATION cycle: there is no new test, so the fact-check IS the gate. Verify EVERY factual claim the diff asserts against current source — open the cited file, read the cited line. A claim you cannot verify against source is a BLOCKER, not a NIT, even when it reads plausibly. A stale cross-reference, a path that no longer resolves, or a cited line number that has moved is likewise a BLOCKER. Skip the test-coverage category and say so in skippedCategories.\n`
  : ''}Tag findings BLOCKER / REFACTOR / NIT per ${RULES}/tdd.md §Reviewer issue tags. verdict=APPROVED only with zero BLOCKER and zero REFACTOR findings. You never edit files.
EVERY finding requires an \`evidence\` field: the exact command you ran and the output line that establishes it — not a description of what you expect it to show. Establish your baseline first: you are reviewing THIS cycle's diff in the working dir named above, so a failure originating in another cycle's files, or a diff taken against the wrong base, is not a finding here. If you cannot produce a command whose output shows the defect, you have not established it — do not raise it.`,
    { label: `review:pass-${pass}`, phase: 'REVIEW', schema: VERDICT_SCHEMA, agentType: 'Code Reviewer', model: MODELS.top })
  if (!review) throw new Error(`reviewer pass ${pass} died`)
  const blocking = review.findings.filter(f => f.tag === 'BLOCKER' || f.tag === 'REFACTOR')
  const claimedApproved = review.verdict === 'APPROVED'
  const mechanicallyApproved = blocking.length === 0
  reviewLog.push({ pass, verdict: review.verdict, mechanicallyApproved, findings: review.findings, skippedCategories: review.skippedCategories })
  if (claimedApproved !== mechanicallyApproved) {
    return { halted: 'inconsistent-review-verdict', detail: `Reviewer returned ${review.verdict} with ${blocking.length} blocking findings.`, gate, architectVerdict, red, green, reviewLog, refactors, hallucinationsRejected }
  }
  if (mechanicallyApproved) { approved = true; break }

  // Adversarial verification — the hallucination guard, systematized. One verifier for the
  // whole pass: see REFUTE_SCHEMA for why the per-finding fan-out was not worth its tokens.
  const verification = await agent(`${VERIFY_COMMON}

Verify ${blocking.length} code-review finding(s) against ACTUAL repo state, with one independent verdict each.
Gate command for this cycle: ${lastReport.command}
Confirm your working directory with pwd before you trust any command output.

Findings:
${blocking.map((f, i) => `[${i}] ${f.tag} — ${f.file || 'unknown file'}${f.line ? `:${f.line}` : ''}\n     claim: ${f.finding}\n     reviewer's stated evidence: ${f.evidence}`).join('\n')}

Return one { index, refuted, evidence } per finding, index matching the [n] above — every finding, no extras, no duplicates.
Start by re-running the reviewer's own stated evidence command: if it does not reproduce their claim, that is a refutation. Then check the claim independently.
refuted=true ONLY with hard evidence the finding misstates repo state (the file exists, the branch is covered, the import is used, the failure came from a different cycle's files). Plausible-but-unverified stays refuted=false — an unverifiable finding survives.
Judge each finding on its own; sharing a file is not sharing a fate. evidence: the exact command + the output line that decides it.`,
    { label: `verify:pass-${pass}`, phase: 'REVIEW', schema: REFUTE_SCHEMA, agentType: 'Finding Verifier', model: MODELS.mid })

  // Index-align defensively: a duplicated, missing, or out-of-range index must read as
  // "not verified", never as a refutation.
  const byIndex = new Map()
  for (const v of (verification && verification.verdicts) || []) {
    if (Number.isInteger(v.index) && v.index >= 0 && v.index < blocking.length && !byIndex.has(v.index)) {
      byIndex.set(v.index, v)
    }
  }
  if (byIndex.size !== blocking.length) {
    return { halted: 'finding-verification-failed', detail: `Verifier returned ${byIndex.size} usable verdict(s) for ${blocking.length} blocking finding(s); missing verification is never treated as refutation.`, gate, architectVerdict, red, green, reviewLog, refactors, hallucinationsRejected }
  }

  // Read through a default rather than indexing directly: an absent verdict must resolve to
  // "not refuted" on its own, so the invariant holds even if the coverage halt above is ever
  // bypassed. A finding survives unless something actively refuted it.
  const verdictFor = (i) => byIndex.get(i) || { refuted: false, evidence: 'no verdict returned' }
  const confirmed = blocking.filter((_, i) => !verdictFor(i).refuted)
  blocking.forEach((f, i) => {
    if (verdictFor(i).refuted) hallucinationsRejected.push({ claim: `[${f.tag}] ${f.finding}`, evidence: verdictFor(i).evidence, pass })
  })
  log(`REVIEW pass ${pass}: ${blocking.length} blocking — ${confirmed.length} confirmed, ${blocking.length - confirmed.length} refuted`)
  if (!confirmed.length) { refutedOnlyPasses += 1; continue } // all refuted → fresh pass, guard inlined, budget untouched
  refutedOnlyPasses = 0
  productivePasses += 1

  phase('REFACTOR')
  const refactor = await agent(`${COMMON}
REFACTOR phase for cycle ${A.cycle}: resolve EVERY confirmed finding below (NO-DEFER). Tests stay green; no new public API; never weaken a test to fit the fix.
Prior implementation report: files ${JSON.stringify(lastReport.filesTouched)}, gate ${lastReport.gateResult}.
Confirmed findings:
${confirmed.map(f => `- [${f.tag}] ${f.file || ''}: ${f.finding}${f.expectedRemediation ? ` → ${f.expectedRemediation}` : ''}`).join('\n')}
Return resolutions: one entry per finding stating exactly how it was resolved. gateResult format "Passed: N / Failed: 0".`,
    { label: `refactor:p${pass}`, phase: 'REFACTOR', schema: REFACTOR_SCHEMA, agentType: A.greenAgent, model: MODELS.mid })
  if (!refactor) throw new Error(`REFACTOR pass ${pass} died`)
  refactors.push({ pass, filesTouched: refactor.filesTouched, gateResult: refactor.gateResult, resolutions: refactor.resolutions, deviations: refactor.deviations })
  refactor.filesTouched.forEach(f => reviewScope.add(f))
  lastReport = refactor
}

// ---- Security tier second pass ----
// Every pass is kept, not just the last: reassigning discarded a first-pass failure and its
// findings the moment pass two approved, which is precisely the record a security-tier cycle
// note is supposed to carry. `securityReview` stays the latest pass so existing readers and
// the neutral spec's singular "security review" are unaffected.
const securityReviews = []
let securityReview = null
if (securityTier) {
  for (let spass = 1; spass <= 2; spass++) {
    const sec = await agent(`${COMMON}
SECURITY-TIER second-pass review (pass ${spass}) for cycle ${A.cycle} per ${RULES}/cycle-orchestration.md §Security tier. Review the diff against ${RULES}/review-checklist.md §Security plus threat-model completeness (attacker-can / mitigation-blocks / residual-risk).
Files: ${JSON.stringify([...reviewScope])}; tests: ${JSON.stringify(testFiles)}; gate: ${lastReport.gateResult}.
verdict=APPROVED only with zero BLOCKER/REFACTOR findings. You never edit files.`,
      { label: `security:pass-${spass}`, phase: 'REVIEW', schema: VERDICT_SCHEMA, agentType: 'Security Reviewer', model: MODELS.top })
    if (!sec) throw new Error('security reviewer died')
    const sblock = sec.findings.filter(f => f.tag === 'BLOCKER' || f.tag === 'REFACTOR')
    const claimedApproved = sec.verdict === 'APPROVED'
    const mechanicallyApproved = sblock.length === 0
    securityReview = { pass: spass, verdict: sec.verdict, mechanicallyApproved, findings: sec.findings }
    securityReviews.push(securityReview)
    if (claimedApproved !== mechanicallyApproved) {
      return { halted: 'inconsistent-security-verdict', detail: `Security reviewer returned ${sec.verdict} with ${sblock.length} blocking findings.`, gate, architectVerdict, red, green, reviewLog, refactors, hallucinationsRejected, securityReview }
    }
    if (mechanicallyApproved) break

    // `!sblock.length` was dead here — zero blocking findings implies mechanicallyApproved,
    // which already broke out of the loop above.
    if (spass === 2) {
      return { halted: 'security-review-not-approved', gate, architectVerdict, red, green, reviewLog, refactors, hallucinationsRejected, securityReview, securityReviews }
    }
    phase('REFACTOR')
    const fix = await agent(`${COMMON}
Resolve EVERY security finding below (NO-DEFER; security-tier — idiomatic, fully-explained security code, normal tone):
${sblock.map(f => `- [${f.tag}] ${f.file || ''}: ${f.finding}`).join('\n')}
Tests stay green. Return resolutions per finding. gateResult format "Passed: N / Failed: 0".`,
      { label: 'refactor:security', phase: 'REFACTOR', schema: REFACTOR_SCHEMA, agentType: A.greenAgent, model: MODELS.mid })
    if (!fix) throw new Error('security refactor died')
    refactors.push({ pass: `security-${spass}`, filesTouched: fix.filesTouched, gateResult: fix.gateResult, resolutions: fix.resolutions, deviations: fix.deviations })
    // The remediation's files belong in scope too: pass 2 is the gate that approves the cycle,
    // so it has to see both the original diff and what the fix did to it.
    fix.filesTouched.forEach(f => reviewScope.add(f))
    lastReport = fix
  }
}

return {
  approved: true,
  cycle: A.cycle, project: A.project, plan: A.plan, securityTier, noTdd,
  gate: { mode: gate.mode, specSummary: gate.specSummary },
  architectVerdict, red, green, refactors, reviewLog, hallucinationsRejected, securityReview, securityReviews,
  reviewerIdConvention: 'record reviewer-agent-id as wf:<runId>/review-pass-<N> (runId is in the Workflow tool result)',
  next: `Orchestrator: walk cycle-orchestration.md §Definition of done (1)-(8) — update plan status, file ${A.projectPath}/docs/cycles/${A.cycle}.yaml (npm run validate-cycle-note), regenerate docs (npm run build -- ${A.project}). Commit stays with the user / autonomous-run protocol.`,
}
