export const meta = {
  name: 'plan-batch',
  description: 'Run one plan batch: preflight disjoint file-ownership + deps, then tdd-cycle per cycle (parallel when safe)',
  whenToUse: 'User opts into workflow execution of a whole batch from a plan YAML. Cycles share the working tree — preflight enforces the plan file-ownership matrix; test-resource collision risk forces sequential mode.',
  phases: [
    { title: 'Preflight', detail: 'deps done, file-ownership disjoint, architect fields present' },
    { title: 'Cycles', detail: 'tdd-cycle child workflow per cycle' },
  ],
}

// Required args: { project, projectPath, plan, batch }
// Optional: cycles [{cycle, greenAgent, redAgent?, securityTier?}] to restrict/override, models {top, mid}
const A = args || {}
for (const k of ['project', 'projectPath', 'plan', 'batch']) {
  if (!A[k]) throw new Error(`args.${k} required — { project, projectPath, plan, batch, cycles?, models? }`)
}

const PLAN_PATH = `${A.projectPath}/docs/plan-${A.plan}.yaml`

phase('Preflight')
const PRE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['ok', 'cycles', 'testCollisionRisk', 'notes'],
  properties: {
    ok: { type: 'boolean' },
    notes: { type: 'string' },
    testCollisionRisk: { type: 'boolean' },
    cycles: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['cycle', 'greenAgent', 'securityTier'], properties: {
      cycle: { type: 'string' },
      greenAgent: { type: 'string' },
      redAgent: { type: 'string' },
      securityTier: { type: 'boolean' },
    } } },
  },
}

const pre = await agent(`Read ${PLAN_PATH} (cwd = repo root). Target batch: "${A.batch}".
1. List the batch's cycles in id order. For each: greenAgent = the owning implementation role defined in .agents/roles/ (e.g. "React Expert"), redAgent if the plan assigns a separate test author, securityTier per the plan/cycle spec (cross-check .agents/rules/cycle-orchestration.md §Security tier).
2. ok=false + explain in notes if ANY of: a cycle's deps are not all status=done; file-ownership overlaps between two cycles inside this batch; a cycle is missing its "Architecture review:" field.
3. testCollisionRisk=true if these cycles' test suites contend for shared resources (same DB container, fixed ports, same dev server). When in doubt, true.
${A.cycles ? `Restrict to these cycles: ${JSON.stringify(A.cycles.map(c => (c && c.cycle) || c))}` : ''}
Return data only.`, { label: 'preflight', phase: 'Preflight', schema: PRE_SCHEMA })
if (!pre) throw new Error('preflight died')
if (!pre.ok) return { halted: 'preflight-failed', notes: pre.notes, cycles: pre.cycles }

const overrides = {}
for (const c of (A.cycles || [])) if (c && c.cycle) overrides[c.cycle] = c
const jobs = pre.cycles.map(c => ({ ...c, ...(overrides[c.cycle] || {}) }))

phase('Cycles')
const runOne = (c) => workflow('tdd-cycle', {
  project: A.project, projectPath: A.projectPath, plan: A.plan,
  cycle: c.cycle, greenAgent: c.greenAgent, redAgent: c.redAgent,
  securityTier: c.securityTier, models: A.models,
})

let results = []
if (pre.testCollisionRisk) {
  log(`test-collision risk (${pre.notes}) — running ${jobs.length} cycles sequentially`)
  for (const c of jobs) {
    const r = await runOne(c).catch(e => ({ halted: 'child-workflow-error', detail: String(e) }))
    results.push({ cycle: c.cycle, ...r })
    if (r && r.halted) { log(`cycle ${c.cycle} halted — stopping batch`); break }
  }
} else {
  log(`file-ownership disjoint, no test collision — running ${jobs.length} cycles concurrently`)
  results = (await parallel(jobs.map(c => () =>
    runOne(c).then(r => ({ cycle: c.cycle, ...r })).catch(e => ({ cycle: c.cycle, halted: 'child-workflow-error', detail: String(e) }))
  ))).filter(Boolean)
}

return {
  batch: A.batch,
  completed: results.filter(r => r.approved).map(r => r.cycle),
  halted: results.filter(r => r.halted),
  results,
  next: 'Per completed cycle: orchestrator walks cycle-orchestration.md §Definition of done (plan status, cycle note, docs regen). Commits stay with the user / autonomous-run protocol.',
}
