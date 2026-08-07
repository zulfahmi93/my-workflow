export const meta = {
  name: 'cycle-to-commit',
  description: 'One plan cycle in an isolated worktree: tdd-cycle → close findings by CLASS until dry → independent commit gate',
  whenToUse: 'An autonomous run where a cycle must reach commit-ready with nothing left open, including NITs. Wraps tdd-cycle, which approves at zero BLOCKER/REFACTOR and leaves NITs behind.',
  phases: [
    { title: 'Cycle', detail: 'tdd-cycle child workflow' },
    { title: 'Close', detail: 'resolve findings by class, not by cited instance' },
    { title: 'Verify', detail: 'independent verifier gathers its own evidence' },
    { title: 'Gate', detail: 'fresh reviewer decides commit-readiness' },
  ],
}

// Required args: { project, projectPath, plan, cycle, greenAgent }
// Optional: redAgent, securityTier, models, maxCloseRounds (default 3), extraNotice
const A = typeof args === 'string' ? JSON.parse(args) : (args || {})
// Accept the neutral spec's greenRole/redRole alongside the legacy greenAgent/redAgent
// keys. Following .agents/workflows/*.md verbatim used to fail on a required-arg check.
if (A.greenRole && !A.greenAgent) A.greenAgent = A.greenRole
if (A.redRole && !A.redAgent) A.redAgent = A.redRole
for (const k of ['project', 'projectPath', 'plan', 'cycle', 'greenAgent']) {
  if (!A[k]) throw new Error(`args.${k} is required`)
}

// Resolved relative to THIS file, never an absolute path: the sibling adapter always sits
// beside it, and a hardcoded home directory breaks on every other checkout — including a
// git worktree, which is the one situation this workflow exists to serve.
const TDD = new URL('./tdd-cycle.js', import.meta.url).pathname
const MAX_ROUNDS = A.maxCloseRounds || 3
const WT = A.projectPath

// `tdd-cycle` is invoked by PATH, not by name: name-based resolution serves the copy
// registered when the session began, so a mid-session edit to the adapter is silently ignored.
const ISOLATION = `ISOLATION — READ BEFORE ANY FILE OPERATION.
${WT} is a dedicated git worktree on branch cycle/${A.cycle}. Every read, edit and test run for this cycle happens THERE. Run \`pwd\` in it once and confirm before you touch anything — a reviewer in an earlier run reported a gate result from the wrong worktree.
The project's primary checkout and any sibling worktree belong to other cycles. Do not read the plan from them, do not edit them, do not run the suite in them.
Do not commit, do not branch, do not create docs/cycles/, and do not touch any cycle's \`status:\` field — the orchestrator owns all of that.${A.extraNotice ? `\n${A.extraNotice}` : ''}`

phase('Cycle')
const cycleResult = await workflow({ scriptPath: TDD }, {
  project: A.project, projectPath: WT, plan: A.plan, cycle: A.cycle,
  greenAgent: A.greenAgent, redAgent: A.redAgent, securityTier: A.securityTier,
  models: A.models, notice: ISOLATION,
})
if (!cycleResult || cycleResult.halted) {
  return { halted: (cycleResult && cycleResult.halted) || 'tdd-cycle-died', cycleResult }
}

// tdd-cycle approves at zero BLOCKER/REFACTOR, so NITs survive approval. Collect them from
// EVERY pass and from EVERY security pass, not just the last of each: a NIT raised on pass 1
// that the approving reviewer did not restate would otherwise ship open, which is exactly
// what this wrapper exists to prevent. Deduped on tag+file+text.
//
// `securityReviews` (plural) is the one to read. The singular `securityReview` is overwritten
// per pass by tdd-cycle — which added the plural expressly to stop losing pass 1 — so reading
// it dropped the whole first security pass: its findings never reached `open`, could not
// trigger `close-rounds-exhausted`, and were absent from the returned record, under a workflow
// whose entire contract is "nothing ships open, however small". Fall back to the singular only
// for a child record old enough not to carry the plural.
const securityPasses = cycleResult.securityReviews || [cycleResult.securityReview].filter(Boolean)
const allPasses = [
  ...(cycleResult.reviewLog || []).map(p => ({ ...p, refactorPass: String(p.pass) })),
  // tdd-cycle keys a security remediation `security-<pass>`, so the two pass-1s never collide.
  ...securityPasses.map(p => ({ ...p, refactorPass: `security-${p.pass}` })),
]

// SUBTRACT what the cycle already settled, or this loop re-opens findings that were paid for.
// Reproduced: 3 findings handed to the closer when 1 was genuinely open — including one the
// Finding Verifier had refuted with `git diff --stat`. CLASS_RULE below then orders a mechanical
// sweep for every instance of a defect class already proven not to exist, rejectable "only with
// a refuting command output", so the closer must re-derive a refutation that was already bought
// or invent a fix for a defect that was never there.
//
// Settled means one of two things, both read STRUCTURALLY rather than by matching finding prose
// (tdd-cycle carries no stable finding id; a refactor's `resolutions[].finding` is free text the
// implementer wrote, and matching on it would drop live findings by accident — the opposite and
// worse error):
//   REFUTED  — the verifier rejected the claim. tdd-cycle records it in hallucinationsRejected
//              under the same `[tag] finding` string it built the claim from, stamped with its
//              pass. Key on both: the same text refuted on pass 1 and re-raised unrefuted on
//              pass 3 is a live finding, not a settled one.
//   RESOLVED — the finding was blocking, so it went to that pass's REFACTOR under NO-DEFER and
//              a refactors[] entry for the pass exists. Whether the fix took is not this loop's
//              call: a LATER review pass reviewed the result and re-raises anything still real.
//              NITs are never handed to a refactor, so they stay open — the gap this wrapper
//              exists to close.
// The pass/claim composite key uses a printable separator, not \0. A literal NUL written into
// this source made file(1) report the adapter as `data`, and grep then matches nothing in it
// silently. A claim always starts with "[TAG]" and a pass is a number or "security-N", so a
// space cannot make two different keys collide here.
const refutedInPass = new Set()
const refutedAnyPass = new Set()
for (const h of cycleResult.hallucinationsRejected || []) {
  if (h.pass === undefined || h.pass === null) refutedAnyPass.add(h.claim)
  else refutedInPass.add(`pass ${h.pass} ${h.claim}`)
}
const refactoredPasses = new Set((cycleResult.refactors || []).map(r => String(r.pass)))

const seen = new Set()
let open = []
const settled = { refuted: 0, resolved: 0 }
for (const pass of allPasses) {
  for (const f of pass.findings || []) {
    const claim = `[${f.tag}] ${f.finding}`
    if (refutedInPass.has(`pass ${pass.pass} ${claim}`) || refutedAnyPass.has(claim)) { settled.refuted += 1; continue }
    const blocking = f.tag === 'BLOCKER' || f.tag === 'REFACTOR'
    if (blocking && refactoredPasses.has(pass.refactorPass)) { settled.resolved += 1; continue }
    // Only a KEPT finding marks the dedupe key: a settled pass-1 instance must not mask an
    // identical restatement from a later pass, which is evidence it is still open.
    const key = `${f.tag} ${f.file || ''} ${f.finding}`
    if (seen.has(key)) continue
    seen.add(key)
    open.push({ tag: f.tag, file: f.file, finding: f.finding })
  }
}
log(`findings: ${open.length} open (${settled.refuted} refuted by the verifier, ${settled.resolved} resolved in-cycle)`)

const CLOSE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['classes', 'gateResult'],
  properties: {
    gateResult: { type: 'string' },
    classes: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['className', 'enumerationCommand', 'instancesFound', 'instancesFixed'],
      properties: {
        className: { type: 'string' },
        enumerationCommand: { type: 'string' },
        instancesFound: { type: 'number' },
        instancesFixed: { type: 'number' },
        mutationEvidence: { type: 'string' },
        notFixed: { type: 'array', items: { type: 'string' } },
      } } },
  },
}

const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['dry', 'openFindings', 'gateResult'],
  properties: {
    dry: { type: 'boolean' },
    gateResult: { type: 'string' },
    openFindings: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['tag', 'finding'],
      properties: { tag: { type: 'string', enum: ['BLOCKER', 'REFACTOR', 'NIT'] }, finding: { type: 'string' }, file: { type: 'string' } } } },
  },
}

// Fixing exactly the lines a reviewer cited is what makes these rounds fail to converge:
// the next reviewer finds the same class one section or one construct over. Enumerate instead.
const CLASS_RULE = `Do NOT fix only the cited lines. For each finding, name its CLASS, enumerate EVERY instance of that class mechanically across the files this cycle owns, and close all of them in one pass. Report the enumeration command and its match count so the sweep is auditable. A class you cannot enumerate mechanically is one you have not understood yet.
Where a finding is that some value is untested — a literal, a default, a field assignment — close it by MUTATION, not by inspection: change the value, run the suite, confirm it fails, restore, confirm it passes. Report the observed failure line. Never add an assertion you have not seen fail, and never weaken an existing one to make a fix land.
A finding may be rejected only with a refuting command output. Disagreement is not refutation.`

const rounds = []
for (let r = 1; r <= MAX_ROUNDS && open.length; r++) {
  phase('Close')
  const closed = await agent(`${ISOLATION}

Cycle ${A.cycle} was APPROVED with findings still open. This run's standing directive is that nothing ships open, however small.

Open findings:
${open.map((f, i) => `${i + 1}. [${f.tag}] ${f.file || ''} — ${f.finding}`).join('\n\n')}

${CLASS_RULE}

Full suite green at the end; gateResult "Passed: N / Failed: 0".`,
    { label: `close:r${r}`, phase: 'Close', schema: CLOSE_SCHEMA, agentType: A.greenAgent, model: (A.models && A.models.mid) || 'sonnet' })
  if (!closed) return { halted: 'closer-died', round: r, cycleResult, rounds }

  phase('Verify')
  const verified = await agent(`${ISOLATION}

You are an INDEPENDENT verifier; you made none of these edits and must not trust the report describing them.
The implementer swept by class. Reported: ${JSON.stringify(closed.classes)}

Re-run each enumeration command YOURSELF, and devise one of your own per class — an under-matching grep is how sibling instances repeatedly survive these rounds. For any value the implementer claims is now pinned, mutate it yourself and confirm the suite fails; a claim of coverage is not coverage.

Then review the cycle's whole diff and list every genuinely actionable remaining issue. Do not manufacture a finding to appear thorough — one you cannot tie to a specific line is not a finding. dry=true only when openFindings is empty. Run the suite yourself. You never edit files.`,
    { label: `verify:r${r}`, phase: 'Verify', schema: VERIFY_SCHEMA, agentType: 'Code Reviewer', model: (A.models && A.models.top) || 'opus' })
  if (!verified) return { halted: 'verifier-died', round: r, cycleResult, rounds }

  rounds.push({ round: r, classes: closed.classes, dry: verified.dry, remaining: verified.openFindings.length })
  open = verified.dry ? [] : verified.openFindings
  log(`close round ${r}: ${verified.dry ? 'dry' : `${open.length} still open`}`)
}

// Exhausting the rounds with findings still open is a stop, not an opinion to hand the
// gate. This workflow's contract is "nothing ships open, however small"; falling through
// silently downgraded a convergence failure into one reviewer's judgement call.
if (open.length) {
  return { halted: 'close-rounds-exhausted', detail: `${open.length} finding(s) still open after ${MAX_ROUNDS} close rounds.`, open, rounds, cycleResult }
}

phase('Gate')
const GATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['worktreeConfirmed', 'verdict', 'commitReady', 'findings', 'gateResult', 'filesInDiff'],
  properties: {
    worktreeConfirmed: { type: 'string' },
    verdict: { type: 'string', enum: ['APPROVED', 'NEEDS_FIX'] },
    commitReady: { type: 'boolean' },
    gateResult: { type: 'string' },
    filesInDiff: { type: 'array', items: { type: 'string' } },
    findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['tag', 'finding'], properties: { tag: { type: 'string', enum: ['BLOCKER', 'REFACTOR', 'NIT'] }, finding: { type: 'string' }, file: { type: 'string' } } } },
    trackedFollowUps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['item', 'ownedByCycle'], properties: { item: { type: 'string' }, ownedByCycle: { type: 'string' } } } },
  },
}

const gate = await agent(`${ISOLATION}

You are the COMMIT GATE for cycle ${A.cycle} of plan-${A.plan}, a fresh independent reviewer. Several review rounds preceded you; you decide whether this commits.

1. Run \`pwd\` in ${WT} and report it as worktreeConfirmed. Report filesInDiff from \`git -C ${WT} status --porcelain\` — every path must be inside ${WT}.
2. Review the entire cycle diff (tracked and untracked) against .agents/rules/review-checklist.md and the cycle's spec in ${WT}/docs/plan-${A.plan}.yaml.
3. Run the suite yourself and quote the exact result line.
4. For a no-tdd docs cycle the fact-check IS the gate: verify every factual claim against the source it cites, and treat an unverifiable claim as a BLOCKER.

Bar: would this MISLEAD A READER or HIDE A BUG? If yes it is a finding; if it is a preference it is not. Anything real whose remedy belongs to a later cycle goes in trackedFollowUps with the owning cycle — a legitimate outcome, and it gets written into the cycle note.
If the diff is sound, say so plainly and set commitReady true. Do not manufacture a finding to appear diligent; do not suppress one to appear finished.
You never edit files.`,
  { label: 'commit-gate', phase: 'Gate', schema: GATE_SCHEMA, agentType: 'Code Reviewer', model: (A.models && A.models.top) || 'opus' })
if (!gate) return { halted: 'commit-gate-died', cycleResult, rounds }

return {
  cycle: A.cycle,
  plan: A.plan,
  approved: cycleResult.approved,
  noTdd: cycleResult.noTdd,
  securityTier: cycleResult.securityTier,
  architectVerdict: cycleResult.architectVerdict,
  // The child's own gate reading, under a name that does not collide with the commit gate this
  // workflow adds below — the cycle note wants arch-review mode and the plan's spec summary.
  cycleGate: cycleResult.gate,
  // red/green were dropped here, which made GREEN's `deviations[]` unrecoverable: the record is
  // the only thing the orchestrator files the cycle note from, and a deviation the implementer
  // declared then vanished from is a deviation nobody reviews.
  red: cycleResult.red,
  green: cycleResult.green,
  reviewLog: cycleResult.reviewLog,
  // `next` below tells the orchestrator to file "the full review-passes[] roster", but the roster
  // was not forwarded — it exists only on the child's return, so the instruction named a field
  // this record did not carry and the cycle note's review-passes[] could not be filled at all.
  reviewPasses: cycleResult.reviewPasses,
  refactors: cycleResult.refactors,
  hallucinationsRejected: cycleResult.hallucinationsRejected,
  // Both: the singular for existing readers and the neutral spec's "security review", the plural
  // so the cycle note's review-passes[] roster carries pass 1 and not only whichever pass ran last.
  securityReview: cycleResult.securityReview,
  securityReviews: securityPasses,
  closeRounds: rounds,
  findingsSettled: settled,
  gate,
  commitReady: gate.commitReady && !gate.findings.length,
  next: `Orchestrator: cycle-orchestration.md §Definition of done — plan status, docs/cycles/${A.cycle}.yaml with the full review-passes[] roster, npm run validate-cycle-note, npm run build, then commit and integrate the worktree branch.`,
}
