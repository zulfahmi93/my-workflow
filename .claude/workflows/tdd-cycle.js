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
// Optional: redAgent (default 'Test Engineer'), securityTier (bool), models ({top, mid} override)
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
for (const k of ['project', 'projectPath', 'plan', 'cycle', 'greenAgent']) {
  if (!A[k]) throw new Error(`args.${k} is required — e.g. { project: "isc-workflow-web", projectPath: "projects/rintis/isc-workflow-web", plan: "004", cycle: "4.2", greenAgent: "React Expert" }`)
}

// Claude-specific tier→model binding for .agents/rules/lifecycle.md §Model capability tiers.
const MODELS = { top: 'opus', mid: 'sonnet', ...(A.models || {}) }
const RED_AGENT = A.redAgent || 'Test Engineer'
const PLAN_PATH = `${A.projectPath}/docs/plan-${A.plan}.yaml`
const RULES = '.agents/rules'
const MAX_REVIEW_PASSES = 4

const COMMON = `Project: ${A.project}. Working dir is the repo root.
Read before acting: ${PLAN_PATH} (cycle ${A.cycle} entry only), the nearest local guide under ${A.projectPath} (AGENTS.md preferred; legacy CLAUDE.md allowed), ${RULES}/tdd.md, ${RULES}/cycle-orchestration.md §Subagent prompt skeleton.
Tone: write idiomatic code/tests/docs (caveman is chat-only and does not apply to subagents).
NO-DEFER: every [BLOCKER]/[REFACTOR] finding is resolved this cycle (${RULES}/tdd.md §Deferral policy).
Out of bounds unless the cycle spec says otherwise: package additions, schema edits, API-contract changes, editing tests during GREEN.`

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
    findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['tag', 'finding'], properties: {
      tag: { type: 'string', enum: ['BLOCKER', 'REFACTOR', 'NIT'] },
      finding: { type: 'string' },
      file: { type: 'string' },
      line: { type: 'number' },
      expectedRemediation: { type: 'string' },
    } } },
    skippedCategories: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['category', 'reason'], properties: { category: { type: 'string' }, reason: { type: 'string' } } } },
  },
}

const REFUTE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['refuted', 'evidence'],
  properties: { refuted: { type: 'boolean' }, evidence: { type: 'string' } },
}

// ---- Gate ----
phase('Gate')
const gate = await agent(`${COMMON}

Task: read ${PLAN_PATH} and extract cycle ${A.cycle}.
1. Find the cycle's "Architecture review:" field. Map to mode: required / deferred / none; if the field is absent, mode = "missing".
2. If deferred to a sibling cycle, read that cycle's architect-verdict from ${A.projectPath}/docs/cycles/<X.Y>.yaml and return its locked-decisions as lockedDecisions (otherwise lockedDecisions = []).
3. specSummary: the cycle's spec in ≤ 200 words (title, phase steps, gate criteria, files in scope).
4. securityTier: true if the plan marks it OR the spec touches any item in ${RULES}/cycle-orchestration.md §Security tier.
5. noTdd: the cycle's "no-tdd" field, verbatim (absent → false). Report what the plan says; do not infer it from the spec.
Return data only.`, { label: 'gate:read-plan', phase: 'Gate', schema: GATE_SCHEMA })
if (!gate) throw new Error('gate reader died')

if (gate.mode === 'missing') {
  return { halted: 'architecture-review-field-missing', detail: `Cycle ${A.cycle} has no "Architecture review:" field in ${PLAN_PATH}. Per cycle-orchestration.md §Architect gate: STOP and ask the user to mark the cycle in the plan.` }
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
let approved = false

for (let pass = 1; pass <= MAX_REVIEW_PASSES && !approved; pass++) {
  const guard = hallucinationsRejected.length
    ? `\nHallucination guard (${RULES}/cycle-orchestration.md §Reviewer hallucination guard): earlier passes produced findings that contradicted verified state. Verify paths with ls/grep and run the gate command BEFORE asserting anything is missing. Rejected claims + evidence:\n${hallucinationsRejected.map(h => `- "${h.claim}" — refuted: ${h.evidence}`).join('\n')}\nPrior gate result stands: ${lastReport.gateResult}.`
    : ''

  const review = await agent(`${COMMON}
You are the independent REVIEW gate (pass ${pass}) for cycle ${A.cycle}. Apply ${RULES}/review-checklist.md to the diff.
Files to review: ${JSON.stringify(lastReport.filesTouched)}${testFiles.length ? ` plus tests ${JSON.stringify(testFiles)}` : ''}
Cycle spec: ${gate.specSummary}
Locked decisions:
${lockedBlock}
Implementer gate result: ${lastReport.gateResult} (command: ${lastReport.command})${guard}
${noTdd
  ? `This is a no-tdd DOCUMENTATION cycle: there is no new test, so the fact-check IS the gate. Verify EVERY factual claim the diff asserts against current source — open the cited file, read the cited line. A claim you cannot verify against source is a BLOCKER, not a NIT, even when it reads plausibly. A stale cross-reference, a path that no longer resolves, or a cited line number that has moved is likewise a BLOCKER. Skip the test-coverage category and say so in skippedCategories.\n`
  : ''}Tag findings BLOCKER / REFACTOR / NIT per ${RULES}/tdd.md §Reviewer issue tags. verdict=APPROVED only with zero BLOCKER and zero REFACTOR findings. You never edit files.`,
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

  // Adversarial verification — the hallucination guard, systematized.
  const verificationResults = await parallel(blocking.map(f => () =>
    agent(`Adversarially verify a code-review finding against ACTUAL repo state (cwd = repo root).
Finding [${f.tag}] on ${f.file || 'unknown file'}: ${f.finding}
Use ls / grep / file reads, and run the gate command (${lastReport.command}) if relevant. refuted=true ONLY with hard evidence the finding misstates repo state (the file exists, the branch is covered, the import is used). Plausible-but-unverified stays refuted=false. evidence: the exact command + output line that decides it.`,
      { label: `verify:p${pass}`, phase: 'REVIEW', schema: REFUTE_SCHEMA, model: MODELS.mid })
      .then(v => ({ f, v }))
  ))
  const checked = Array.isArray(verificationResults) ? verificationResults : []

  const completedVerifications = checked.filter(x => x && x.v).length
  if (completedVerifications !== blocking.length) {
    return { halted: 'finding-verification-failed', detail: `${blocking.length - completedVerifications} blocking finding verifier(s) returned no result.`, gate, architectVerdict, red, green, reviewLog, refactors, hallucinationsRejected }
  }
  const confirmed = checked.filter(x => x.v && !x.v.refuted).map(x => x.f)
  for (const x of checked.filter(x => x.v && x.v.refuted)) {
    hallucinationsRejected.push({ claim: `[${x.f.tag}] ${x.f.finding}`, evidence: x.v.evidence, pass })
  }
  log(`REVIEW pass ${pass}: ${blocking.length} blocking — ${confirmed.length} confirmed, ${blocking.length - confirmed.length} refuted`)
  if (!confirmed.length) continue // every finding refuted → fresh pass with the guard inlined

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
  lastReport = refactor
}

if (!approved) {
  return { halted: 'review-not-approved', detail: `NEEDS FIX after ${MAX_REVIEW_PASSES} passes — autonomous stop condition 5.`, gate, architectVerdict, red, green, reviewLog, refactors, hallucinationsRejected }
}

// ---- Security tier second pass ----
let securityReview = null
if (securityTier) {
  for (let spass = 1; spass <= 2; spass++) {
    const sec = await agent(`${COMMON}
SECURITY-TIER second-pass review (pass ${spass}) for cycle ${A.cycle} per ${RULES}/cycle-orchestration.md §Security tier. Review the diff against ${RULES}/review-checklist.md §Security plus threat-model completeness (attacker-can / mitigation-blocks / residual-risk).
Files: ${JSON.stringify(lastReport.filesTouched)}; tests: ${JSON.stringify(testFiles)}; gate: ${lastReport.gateResult}.
verdict=APPROVED only with zero BLOCKER/REFACTOR findings. You never edit files.`,
      { label: `security:pass-${spass}`, phase: 'REVIEW', schema: VERDICT_SCHEMA, agentType: 'Security Reviewer', model: MODELS.top })
    if (!sec) throw new Error('security reviewer died')
    const sblock = sec.findings.filter(f => f.tag === 'BLOCKER' || f.tag === 'REFACTOR')
    const claimedApproved = sec.verdict === 'APPROVED'
    const mechanicallyApproved = sblock.length === 0
    securityReview = { pass: spass, verdict: sec.verdict, mechanicallyApproved, findings: sec.findings }
    if (claimedApproved !== mechanicallyApproved) {
      return { halted: 'inconsistent-security-verdict', detail: `Security reviewer returned ${sec.verdict} with ${sblock.length} blocking findings.`, gate, architectVerdict, red, green, reviewLog, refactors, hallucinationsRejected, securityReview }
    }
    if (mechanicallyApproved) break

    if (spass === 2 || !sblock.length) {
      return { halted: 'security-review-not-approved', gate, architectVerdict, red, green, reviewLog, refactors, hallucinationsRejected, securityReview }
    }
    phase('REFACTOR')
    const fix = await agent(`${COMMON}
Resolve EVERY security finding below (NO-DEFER; security-tier — idiomatic, fully-explained security code, normal tone):
${sblock.map(f => `- [${f.tag}] ${f.file || ''}: ${f.finding}`).join('\n')}
Tests stay green. Return resolutions per finding. gateResult format "Passed: N / Failed: 0".`,
      { label: 'refactor:security', phase: 'REFACTOR', schema: REFACTOR_SCHEMA, agentType: A.greenAgent, model: MODELS.mid })
    if (!fix) throw new Error('security refactor died')
    refactors.push({ pass: `security-${spass}`, filesTouched: fix.filesTouched, gateResult: fix.gateResult, resolutions: fix.resolutions, deviations: fix.deviations })
    lastReport = fix
  }
}

return {
  approved: true,
  cycle: A.cycle, project: A.project, plan: A.plan, securityTier, noTdd,
  gate: { mode: gate.mode, specSummary: gate.specSummary },
  architectVerdict, red, green, refactors, reviewLog, hallucinationsRejected, securityReview,
  reviewerIdConvention: 'record reviewer-agent-id as wf:<runId>/review-pass-<N> (runId is in the Workflow tool result)',
  next: `Orchestrator: walk cycle-orchestration.md §Definition of done (1)-(8) — update plan status, file ${A.projectPath}/docs/cycles/${A.cycle}.yaml (npm run validate-cycle-note), regenerate docs (npm run build -- ${A.project}). Commit stays with the user / autonomous-run protocol.`,
}
