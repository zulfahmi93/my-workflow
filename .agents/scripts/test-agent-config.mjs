#!/usr/bin/env node

import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeTier } from '../../tools/docs-gen/lib/load-yaml-source.mjs';

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
  if (normalizeTier(input) !== expected) failures.push(`normalizeTier(${input}): expected ${expected}`);
}

const workflow = await readFile(path.join(repoRoot, '.claude/workflows/tdd-cycle.js'), 'utf8');
for (const guard of [
  "claimedApproved !== mechanicallyApproved",
  "halted: 'inconsistent-review-verdict'",
  "halted: 'inconsistent-security-verdict'",
  "halted: 'finding-verification-failed'",
  'completedVerifications !== blocking.length',
]) {
  if (!workflow.includes(guard)) failures.push(`TDD workflow: missing guard ${guard}`);
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
