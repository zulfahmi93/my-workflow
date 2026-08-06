#!/usr/bin/env node

import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Imported lazily. This module pulls in `yaml` from tools/docs-gen, whose node_modules is
// gitignored, so a static import made the ENTIRE suite die with ERR_MODULE_NOT_FOUND in any
// fresh clone or git worktree — which reads as "this commit is broken" and makes `git bisect`
// report false failures across the whole history. Skip the one check, run the rest.
let normalizeTier = null;
try {
  ({ normalizeTier } = await import('../../tools/docs-gen/lib/load-yaml-source.mjs'));
} catch {
  console.error('note: skipping normalizeTier check — run `npm i` in tools/docs-gen/ to enable it');
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const failures = [];

function run(command, args = [], options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });
}

function expectStatus(label, result, status) {
  if (result.status !== status) {
    failures.push(`${label}: expected status ${status}, got ${result.status}\n${result.stderr || result.stdout}`);
  }
}

const commitPolicy = path.join(repoRoot, '.agents/scripts/check-commit-command.sh');
for (const command of [
  'git commit --amend',
  'git -C /tmp/repo commit --no-verify',
  'git -C "$PWD" commit -n',
  'command git commit --amend',
  'command -- git commit --amend',
  'sudo -u root git commit --amend',
  'env -C /tmp git commit --amend',
  'git commit -nq -m x',
  'git commit --am -m x',
  'git commit --no-verif -m x',
  // Shell wrappers hide the whole command in one token, so the executable scan saw only
  // `bash`/`xargs` and waved these through — a complete bypass of both checks.
  "bash -c 'git commit --amend'",
  'sh -c "git commit --no-verify -m x"',
  "bash -lc 'git commit --amend'",
  "bash -c -- 'git commit --amend'",
  "cd /tmp && bash -c 'git commit --no-verify -m x'",
  'xargs git commit --amend',
  'xargs -n 1 git commit --amend',
]) {
  expectStatus(`blocked commit command: ${command}`, run(commitPolicy, [command]), 2);
}
for (const command of [
  'git commit -m "document --amend policy"',
  'echo --amend && git commit -m ok',
  'git status',
  "bash -c 'echo hello'",
  'bash script.sh',
  'xargs rm',
  // The unparseable fallback must fail OPEN as its docstring promises. The old substring
  // pair ("commit" anywhere + the flag anywhere) blocked ordinary prose: the apostrophe
  // defeats the lexer, then `commit` and `--amend` both appear as DATA, not an invocation.
  "echo it doesn't commit; grep -- --amend f",
]) {
  expectStatus(`allowed command: ${command}`, run(commitPolicy, [command]), 0);
}
// A subject long enough to block must still be measured through a shell wrapper.
expectStatus(
  'blocked long subject through bash -c',
  run(commitPolicy, [`bash -c 'git commit -m "feat: ${'x'.repeat(60)}"'`]),
  2,
);

const generatedPolicy = path.join(repoRoot, '.agents/scripts/check-generated-path.sh');
expectStatus('relative generated path', run(generatedPolicy, ['docs/html/index.html']), 2);
expectStatus('absolute generated path', run(generatedPolicy, [path.join(repoRoot, 'docs/html/index.html')]), 2);
expectStatus('normalized generated traversal', run(generatedPolicy, ['docs/templates/../html/index.html']), 2);
expectStatus('canonical template path', run(generatedPolicy, ['docs/templates/adr.md']), 0);
expectStatus('normalized safe traversal', run(generatedPolicy, ['docs/html/../templates/adr.md']), 0);
expectStatus('outside-repo generated-looking path', run(generatedPolicy, ['/tmp/docs/html/index.html']), 0);

const hook = path.join(repoRoot, '.codex/hooks/dispatch-file-policy.py');
const generatedPatch = JSON.stringify({
  tool_input: { command: '*** Begin Patch\n*** Update File: docs/html/index.html\n@@\n-old\n+new\n*** End Patch' },
});
const safePatch = JSON.stringify({
  tool_input: { command: '*** Begin Patch\n*** Update File: docs/templates/adr.md\n@@\n-old\n+new\n*** End Patch' },
});
expectStatus('Codex generated-file hook', run('python3', [hook, 'block-generated'], { input: generatedPatch }), 2);
expectStatus('Codex safe-file hook', run('python3', [hook, 'block-generated'], { input: safePatch }), 0);

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-config-test-'));
try {
  const fakeNpm = path.join(tempDir, 'npm');
  const capture = path.join(tempDir, 'npm-args.txt');
  await writeFile(fakeNpm, '#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE"\n');
  await chmod(fakeNpm, 0o755);
  const relativeCycle = 'docs/cycles/cycle-test.yaml';
  const result = run(path.join(repoRoot, '.agents/scripts/validate-docs-yaml.sh'), [relativeCycle], {
    env: { ...process.env, PATH: `${tempDir}:${process.env.PATH}`, CAPTURE: capture },
  });
  expectStatus('relative cycle YAML dispatch', result, 0);
  const args = await readFile(capture, 'utf8').catch(() => '');
  if (!args.includes(path.join(repoRoot, relativeCycle))) {
    failures.push(`relative cycle YAML dispatch: missing normalized absolute path in ${JSON.stringify(args)}`);
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

for (const [input, expected] of Object.entries({ opus: 'top', sonnet: 'mid', haiku: 'cheap', top: 'top', mid: 'mid', cheap: 'cheap' })) {
  if (normalizeTier && normalizeTier(input) !== expected) failures.push(`normalizeTier(${input}): expected ${expected}`);
}

const workflow = await readFile(path.join(repoRoot, '.claude/workflows/tdd-cycle.js'), 'utf8');
for (const guard of [
  "claimedApproved !== mechanicallyApproved",
  "halted: 'inconsistent-review-verdict'",
  "halted: 'inconsistent-security-verdict'",
  "halted: 'finding-verification-failed'",
  'byIndex.size !== blocking.length',
  "halted: 'reviewer-hallucination-loop'",
]) {
  if (!workflow.includes(guard)) failures.push(`TDD workflow: missing guard ${guard}`);
}

// A wrapper workflow relocates the working dir by passing `notice` (cycle-to-commit.js sends
// its worktree assertion that way), so EVERY delegate must receive it — a verifier running
// the gate command in the wrong tree refutes findings against the wrong code. Grepping for a
// `${COMMON}` interpolation would not have caught this: the finding-verifier sits inside a
// parallel() thunk with its own standalone prompt. Render the workflow instead.
async function renderCycle({ notice, reviewScript, verifyFor }) {
  const calls = [];
  let review = 0;
  const respond = (label, opts) => {
    if (label === 'gate:read-plan') return { mode: 'none', specSummary: 's', securityTier: false, noTdd: false, lockedDecisions: [] };
    if (label === 'red') return { testFiles: ['t.py'], failingCommand: 'p', failureLine: 'f', gateResult: 'Passed: 0 / Failed: 1' };
    if (label === 'green' || label === 'author') return { filesTouched: ['a.py'], gateResult: 'Passed: 1 / Failed: 0', command: 'p', deviations: [] };
    if (label.startsWith('refactor:')) return { filesTouched: ['a.py'], gateResult: 'Passed: 1 / Failed: 0', command: 'p', deviations: [], resolutions: [{ finding: 'x', resolution: 'y' }] };
    if (label.startsWith('review:pass-')) return reviewScript(review += 1);
    if (label.startsWith('verify:')) return verifyFor(opts.lastBlocking);
    return {};
  };
  let lastBlocking = 0;
  const stubs = {
    args: { project: 'p', projectPath: 'projects/personal/p', plan: '001', cycle: '9.9', greenAgent: 'Python Expert', ...(notice ? { notice } : {}) },
    agent: async (prompt, opts = {}) => {
      const label = opts.label || '(unlabelled)';
      calls.push({ label, prompt, agentType: opts.agentType || null, model: opts.model || null });
      const result = respond(label, { ...opts, lastBlocking });
      if (label.startsWith('review:pass-')) {
        lastBlocking = (result.findings || []).filter((f) => f.tag === 'BLOCKER' || f.tag === 'REFACTOR').length;
      }
      return result;
    },
    parallel: (thunks) => Promise.all(thunks.map((thunk) => thunk())),
    phase: () => {},
    log: () => {},
  };
  const render = new Function(
    ...Object.keys(stubs),
    `return (async () => {\n${workflow.replace(/^export const meta/m, 'const meta')}\n})()`,
  );
  return { result: await render(...Object.values(stubs)), calls };
}

const blockingFinding = (n) => ({ tag: 'BLOCKER', finding: `x${n}`, evidence: `ran cmd; saw line ${n}`, file: 'a.py' });
const allVerdicts = (refuted) => (count) => ({ verdicts: Array.from({ length: count }, (_, i) => ({ index: i, refuted, evidence: 'e' })) });

// A wrapper workflow relocates the working dir by passing `notice` (cycle-to-commit.js sends
// its worktree assertion that way), so EVERY delegate must receive it — a verifier running
// the gate command in the wrong tree refutes findings against the wrong code. Grepping for a
// `${COMMON}` interpolation would not have caught this: the finding-verifier had its own
// standalone prompt. Render the workflow instead.
{
  const NOTICE = 'WORKTREE-SENTINEL-FOR-TEST';
  const { calls } = await renderCycle({
    notice: NOTICE,
    reviewScript: (n) => (n === 1
      ? { verdict: 'NEEDS_FIX', findings: [blockingFinding(1)], skippedCategories: [] }
      : { verdict: 'APPROVED', findings: [], skippedCategories: [] }),
    verifyFor: allVerdicts(true),
  });
  if (!calls.length) failures.push('TDD workflow: notice probe invoked no delegates');
  const verifier = calls.find((c) => c.label.startsWith('verify:'));
  if (!verifier) failures.push('TDD workflow: notice probe never reached the finding-verifier');
  else if (verifier.agentType !== 'Finding Verifier') {
    failures.push(`TDD workflow: verifier agentType is ${verifier.agentType}, expected Finding Verifier`);
  }
  for (const { label, prompt } of calls) {
    if (!prompt.includes(NOTICE)) failures.push(`TDD workflow: delegate ${label} does not receive args.notice`);
  }
  // Batched, not fanned out: one verifier call per pass regardless of finding count.
  const passes = calls.filter((c) => c.label.startsWith('review:pass-')).length;
  const verifiers = calls.filter((c) => c.label.startsWith('verify:')).length;
  if (verifiers > passes) failures.push(`TDD workflow: ${verifiers} verifier calls for ${passes} review passes — expected at most one per pass`);
}

// Refuted-only passes must not consume the productive-pass budget, but must be bounded.
{
  const { result, calls } = await renderCycle({
    reviewScript: () => ({ verdict: 'NEEDS_FIX', findings: [blockingFinding(1), blockingFinding(2)], skippedCategories: [] }),
    verifyFor: allVerdicts(true), // every finding refuted, forever
  });
  if (result.halted !== 'reviewer-hallucination-loop') {
    failures.push(`TDD workflow: endless refuted-only passes halted as ${result.halted}, expected reviewer-hallucination-loop`);
  }
  const reviews = calls.filter((c) => c.label.startsWith('review:pass-')).length;
  if (reviews > 4) failures.push(`TDD workflow: refuted-only loop ran ${reviews} review passes before halting — budget not bounded`);
  // One verifier per pass, not one per finding, even with 2 blocking findings each pass.
  const verifiers = calls.filter((c) => c.label.startsWith('verify:')).length;
  if (verifiers !== reviews) failures.push(`TDD workflow: ${verifiers} verifier calls for ${reviews} passes — expected exactly one per pass`);
}

// A verdict list that does not cover every finding is never treated as refutation.
{
  const { result } = await renderCycle({
    reviewScript: () => ({ verdict: 'NEEDS_FIX', findings: [blockingFinding(1), blockingFinding(2)], skippedCategories: [] }),
    verifyFor: () => ({ verdicts: [{ index: 0, refuted: true, evidence: 'e' }] }), // only 1 of 2
  });
  if (result.halted !== 'finding-verification-failed') {
    failures.push(`TDD workflow: partial verdict list halted as ${result.halted}, expected finding-verification-failed`);
  }
}

// Duplicated indexes must not pass the coverage check either.
{
  const { result } = await renderCycle({
    reviewScript: () => ({ verdict: 'NEEDS_FIX', findings: [blockingFinding(1), blockingFinding(2)], skippedCategories: [] }),
    verifyFor: () => ({ verdicts: [{ index: 0, refuted: true, evidence: 'e' }, { index: 0, refuted: true, evidence: 'e' }] }),
  });
  if (result.halted !== 'finding-verification-failed') {
    failures.push(`TDD workflow: duplicated verdict index halted as ${result.halted}, expected finding-verification-failed`);
  }
}

// Confirmed findings still drive REFACTOR and reach approval.
{
  const { result, calls } = await renderCycle({
    reviewScript: (n) => (n === 1
      ? { verdict: 'NEEDS_FIX', findings: [blockingFinding(1)], skippedCategories: [] }
      : { verdict: 'APPROVED', findings: [], skippedCategories: [] }),
    verifyFor: allVerdicts(false), // confirmed
  });
  if (!result.approved) failures.push(`TDD workflow: confirmed-finding path did not approve (halted: ${result.halted})`);
  if (!calls.some((c) => c.label.startsWith('refactor:'))) failures.push('TDD workflow: confirmed finding did not drive a REFACTOR pass');
}

const cycleValidator = await readFile(path.join(repoRoot, 'tools/docs-gen/scripts/validate-cycle-note.mjs'), 'utf8');
if (!cycleValidator.includes("projects/*/*/docs/cycles/*.{yaml,yml}")) {
  failures.push('cycle-note validator: missing grouped-project no-argument glob');
}

if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log('agent config behavior tests passed');
