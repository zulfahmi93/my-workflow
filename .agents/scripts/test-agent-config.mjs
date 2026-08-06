#!/usr/bin/env node

import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
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

// ajv is a tools/docs-gen dependency and is resolved against THAT package, not this script's own
// directory: `.agents/` has no node_modules and must not grow one to be testable. Gated the same
// way as normalizeTier above and for the same reason — those deps are gitignored, so a fresh
// clone or worktree skips the checks that need them instead of reading as a broken commit.
let Ajv = null;
try {
  const mod = createRequire(path.join(repoRoot, 'tools/docs-gen/package.json'))('ajv');
  Ajv = mod.default || mod;
} catch {
  console.error('note: skipping schema checks — run `npm i` in tools/docs-gen/ to enable them');
}

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
  // Generic exec wrappers hide the real argv one token deeper, so the executable scan resolved
  // `eval`/`timeout`/`nohup`/`nice`/`setsid` as the command and waved the git invocation
  // through — the same bypass as the shell wrappers above, eighteen measured variants wide.
  // `eval` is the worst of them: it takes its payload as ordinary operands, so nothing even
  // looked like a quoted string to notice.
  'eval "git commit --amend --no-edit"',
  'eval git commit --amend -m x',
  "eval 'git commit --amend'",
  'eval -- "git commit --amend"',
  'timeout 120 git commit --no-verify -m x',
  'timeout -s KILL 5s git commit --amend -m x',
  'timeout --preserve-status 5 git commit --amend -m x',
  'timeout 30 -- git commit --amend',
  'nohup git commit --amend -m x',
  'nice git commit --no-verify -m x',
  'nice -n 10 git commit --amend -m x',
  'setsid git commit --amend -m x',
  'stdbuf -o0 git commit --amend -m x',
  'ionice -c2 -n0 git commit --no-verify -m x',
  'chrt -f 10 git commit --no-verify -m x',
  'time git commit --amend -m x',
  // Composition: each wrapper must survive being nested in another, and in the `env`/`command`/
  // `xargs`/`bash -c` arms that already worked. Fixing one arm in isolation leaves the product.
  'nohup nice -n 5 timeout 30 git commit --no-verify -m x',
  'nohup env FOO=1 git commit --amend -m x',
  'command nohup git commit --amend',
  'xargs nice git commit --amend',
  'timeout 30 bash -c "git commit --amend -m x"',
  'bash -c "eval git commit --amend"',
  'nice -n 10 eval "git commit --amend"',
  // Abbreviations and short clusters must still resolve from behind a wrapper.
  'nohup git commit --am -m x',
  'nice git commit -nq -m x',
  // A wrapper operand the lexer cannot resolve must fail CLOSED. Returning "unknown, so allow"
  // is how a bypass gets re-opened by anyone who adds an option to the table.
  'timeout $T git commit --amend -m x',
  'nice --frobnicate git commit --amend -m x',
  // §"Never, even when authorized" named five things and enforced two. These are the subset
  // that cannot be undone by pushing again — rewriting published history — plus opening or
  // merging a PR, which is outward-facing. Plain `git push` stays allowed; see the pass list.
  'git push --force',
  'git push --force-with-lease',
  'git push --force-with-lease=main:abc123 origin',
  'git push --force-if-includes',
  'git push -f origin main',
  'git push origin main -f',
  'git push -uf origin main',
  // The force flag must still be found behind git's own options, an abbreviation, and every
  // wrapper class the table above covers.
  'git push --forc origin main',
  'git -C projects/rintis/kobu-bot push --force',
  'timeout 60 git push --force',
  'bash -c "git push --force-with-lease"',
  'eval "git push -f"',
  'gh pr create --title x --body y',
  'gh pr merge 12 --squash',
  'gh --repo owner/name pr create --title x',
  'env FOO=1 nohup gh pr create',
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
  // The false-positive guards for the wrapper table above, and the ones that matter most: a
  // policy that blocks `timeout 30 npm test` is one an agent learns to work around. Each
  // wrapper is exercised with the option grammar that made it ambiguous — an operand that
  // looks like a command (`nice -n 10 node x.js`), a bare invocation (`time ls`), a wrapper
  // with no operand at all (`nice --help`), and a legal commit seen through one.
  'git commit -m "feat(x): short"',
  'timeout 30 npm test',
  'nice -n 10 node x.js',
  'time ls',
  'nohup npm run dev',
  'setsid ./daemon.sh',
  'chrt -f 10 ./run.sh',
  'ionice -c 2 -n 0 npm run build',
  'stdbuf -o0 -e0 tail -f log.txt',
  'nice --help',
  'timeout --version',
  'timeout 120 bash -c "npm test"',
  'nice -n 10 git commit -m "fix(a): b"',
  'eval "npm test"',
  'eval "$(ssh-agent -s)"',
  'echo "eval is a shell builtin"',
  // Fail-closed is scoped to the SEGMENT that could not be resolved, not the whole command
  // line — otherwise one unparseable segment convicts its innocent siblings.
  'timeout $T npm test',
  'timeout $T npm test; echo "git commit --amend"',
  // Plain `git push` is DELIBERATELY allowed: pushing zulfahmi-portfolio to main is what
  // deploys zulfahmi.dev. Blocking it would break a real workflow to close a theoretical hole.
  'git push origin main',
  'git push',
  'git push -u origin feature',
  'git push --set-upstream origin feature',
  // `--follow-tags` shares a prefix with `--force`; `-o` and `--repo` take values, so a `-f`
  // sitting in the value slot is data, not a flag. Each of these is a way the force check
  // could over-reach into a legitimate push.
  'git push --follow-tags origin main',
  'git push --tags',
  'git push -o ci.skip origin main',
  'git push --push-option=-f origin main',
  'git push --repo -f',
  'git push origin -- -f',
  // Only create/merge are blocked; the read-only and checkout subcommands are ordinary work.
  'gh pr list',
  'gh pr view 12',
  'gh pr checkout 12',
  'gh repo clone x/y',
  'echo "never git push --force to main"',
]) {
  expectStatus(`allowed command: ${command}`, run(commitPolicy, [command]), 0);
}
// A subject long enough to block must still be measured through a shell wrapper. The exec
// wrappers bypassed the SUBJECT check too, not just the flag check — `git commit` never
// reached the policy at all, so nothing was measured.
expectStatus(
  'blocked long subject through bash -c',
  run(commitPolicy, [`bash -c 'git commit -m "feat: ${'x'.repeat(60)}"'`]),
  2,
);
expectStatus(
  'blocked long subject through timeout',
  run(commitPolicy, [`timeout 60 git commit -m "feat: ${'x'.repeat(60)}"`]),
  2,
);
expectStatus(
  'blocked long subject through eval',
  run(commitPolicy, [`eval 'git commit -m "feat: ${'x'.repeat(60)}"'`]),
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

// docs-gen must leave NOTHING on disk when a build aborts. A registry entry whose project is
// not checked out throws from loadPlan — but mkdir -p of outDir used to run first, so the abort
// still materialised projects/<group>/<name>/docs/html, and that stub then made `npm run
// validate` report the plan as a registry error ("listed in projects.config.json but no such
// file") instead of skipping it. Permanently, on unchanged inputs: the failed build had forged
// the very evidence the skip keys off. Both halves are covered — either one alone still leaves
// validate poisoned once anything else creates the directory.
//
// generate.mjs is a CLI with no exports and resolves the repo root from its own location
// (tools/docs-gen → ../..), so the only way to drive it against a fixture tree is to give it
// one: copy the file under test into <tmp>/tools/docs-gen, symlink the siblings it imports by
// relative path, and write a two-project registry. The real projects/ is never touched.
//
// Gated on the same signal as normalizeTier above — generate.mjs imports load-yaml-source.mjs,
// so without tools/docs-gen/node_modules this would fail for a missing dependency rather than
// for a defect, and read as a broken commit under `git bisect`.
if (normalizeTier) {
  const docsGenRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-config-docsgen-'));
  try {
    const toolDir = path.join(docsGenRoot, 'tools/docs-gen');
    await mkdir(path.join(toolDir, 'sites'), { recursive: true });
    await copyFile(path.join(repoRoot, 'tools/docs-gen/generate.mjs'), path.join(toolDir, 'generate.mjs'));
    for (const dep of ['lib', 'assets']) {
      await symlink(path.join(repoRoot, 'tools/docs-gen', dep), path.join(toolDir, dep), 'dir');
    }
    await writeFile(path.join(toolDir, 'sites/fixture.site.json'), JSON.stringify({
      productName: 'Fixture', accent: '#000000', themeKey: 'fixture-theme', footerTagline: 'fixture',
      landing: { eyebrow: 'e', title: 't', lede: 'l' },
    }));
    const entry = (name, plans) => ({
      name,
      docsRoot: `projects/personal/${name}/docs`,
      outDir: `projects/personal/${name}/docs/html`,
      site: 'fixture.site.json',
      plans,
    });
    const writeRegistry = (projects) => writeFile(path.join(toolDir, 'projects.config.json'), JSON.stringify({ projects }));
    await writeRegistry([entry('present', [{ id: '001' }]), entry('ghost', [{ id: '001' }])]);

    const presentDocs = path.join(docsGenRoot, 'projects/personal/present/docs');
    await mkdir(presentDocs, { recursive: true });
    // Cycle 1.2 is the drift fixture: it DECLARES `tier: mid` and its session prompt restates the
    // gate as "REQUIRED (sonnet)", while the runtime gates every required review at the top tier
    // regardless. Both stale values have to be schema-valid to be worth testing — plan.schema.json
    // enums `tier` to top|mid|opus|sonnet and leaves the prompt an unconstrained string, which is
    // exactly why the drift was invisible. Same for `meta-raw`, which opens with its own declared
    // `opus` on a phase whose runtime tier is fixed.
    await writeFile(path.join(presentDocs, 'plan-001.yaml'), [
      'id: "001"', 'project: present', 'title: Fixture plan', 'cycles:',
      '  - id: "1.1"', '    title: A cycle', '    primary: [Test Engineer]',
      '    arch-review:', '      state: none', '    status: idle',
      '  - id: "1.2"', '    title: A gated cycle', '    primary: [Test Engineer]',
      '    arch-review:', '      state: required', '      tier: mid', '      reviewer: Test Engineer',
      '    status: idle',
      '    phases:', '      review:', '        meta-raw: "`opus` — `code-reviewer`"', '        body: review it',
      '    session:', '      title: Cycle 1.2', '      prompt: |',
      '        Architecture review: **REQUIRED (sonnet)**. Spawn `software-architect` (sonnet) via `Agent` BEFORE RED.',
      '        Begin Cycle 1.2.',
      'batches:', '  - id: B1', '    cycles: ["1.2"]', '',
    ].join('\n'));

    const generate = path.join(toolDir, 'generate.mjs');
    const exists = (rel) => access(path.join(docsGenRoot, rel)).then(() => true).catch(() => false);
    const ghostRoot = 'projects/personal/ghost';

    const failedBuild = run('node', [generate, 'ghost']);
    if (failedBuild.status === 0) failures.push('docs-gen: build of an absent project should fail, exited 0');
    if (await exists(ghostRoot)) {
      failures.push(`docs-gen: aborted build left ${ghostRoot} behind — outDir is created before the sources are resolved`);
    }
    expectStatus('docs-gen validate after an aborted build', run('node', [generate, '--validate']), 0);

    // Half two on its own: even when something else creates the stub (an older binary, a
    // concurrent process), an output dir alone must not read as a checked-out project.
    await mkdir(path.join(docsGenRoot, ghostRoot, 'docs/html/assets'), { recursive: true });
    expectStatus('docs-gen validate with only a generated stub', run('node', [generate, '--validate']), 0);

    // …but the skip must stay narrow. A registry typo inside a project that IS checked out is
    // still a hard failure; that is the defect the skip was carved out of.
    expectStatus('docs-gen build of a real project', run('node', [generate, 'present']), 0);
    if (!(await exists('projects/personal/present/docs/html/index.html'))) {
      failures.push('docs-gen: successful build wrote no landing page — the ordering fix must not skip output');
    }

    // Everything the site publishes about a cycle's tier must come from the fields the RUNTIME
    // reads — `arch-review.state` / `deferred-to` plus the standing policy — never from the plan's
    // own declaration or from the prose restatement in the session prompt. Both of those drifted:
    // six susun-jadual cycles advertised "architect: required (mid)" for a gate that has always
    // run at `top`, 40 of 111 required gates across the corpus declared a tier below the policy
    // floor, and 85 session prompts carry a second, hand-maintained copy of the same field. A
    // reader costing a plan off this site was being told a price nothing charges.
    //
    // Asserted through a real build rather than against the loader's exports: the badge, the phase
    // meta line and the runbook prompt are three separate render paths off one policy constant,
    // and only the built page proves all three agree.
    const planHtml = await readFile(path.join(docsGenRoot, 'projects/personal/present/docs/html/001/plan.html'), 'utf8').catch(() => '');
    const runbookHtml = await readFile(path.join(docsGenRoot, 'projects/personal/present/docs/html/001/batches.html'), 'utf8').catch(() => '');
    const publishes = (label, html, wanted, forbidden) => {
      if (!html) { failures.push(`docs-gen: ${label} was not generated`); return; }
      for (const want of wanted) if (!html.includes(want)) failures.push(`docs-gen: ${label} does not publish ${JSON.stringify(want)}`);
      for (const no of forbidden) if (html.includes(no)) failures.push(`docs-gen: ${label} still publishes ${JSON.stringify(no)} — that value came from the plan's declaration, not from the runtime policy`);
    };
    publishes('the cycle badge', planHtml,
      ['architect: required (top)', 'architect: none'],
      ['architect: required (mid)', 'architect: required (sonnet)']);
    // The phase meta line publishes the runtime tier and drops the declared one that opened
    // `meta-raw`, keeping the agent name that followed it.
    publishes('the phase meta line', planHtml, ['`top` — `code-reviewer`'], ['`opus` — `code-reviewer`']);
    // The runbook prompt: only the BOLD declaration is re-derived. The operational tail is nobody
    // else's copy — it names which reviewer to spawn — so it must survive the splice untouched,
    // stale parenthetical and all.
    publishes('the runbook session prompt', runbookHtml,
      ['Architecture review: **REQUIRED (top)**.', 'Spawn `software-architect` (sonnet) via `Agent` BEFORE RED.', 'Begin Cycle 1.2.'],
      ['REQUIRED (sonnet)']);
    await writeRegistry([entry('present', [{ id: '001' }, { id: '999' }]), entry('ghost', [{ id: '001' }])]);
    expectStatus('docs-gen validate with a registry typo in a checked-out project', run('node', [generate, '--validate']), 1);
  } finally {
    await rm(docsGenRoot, { recursive: true, force: true });
  }
}

// The two live provider aliases map, and the canonical tiers are idempotent.
for (const [input, expected] of Object.entries({ opus: 'top', sonnet: 'mid', top: 'top', mid: 'mid' })) {
  if (normalizeTier && normalizeTier(input) !== expected) {
    failures.push(`normalizeTier(${input}): expected ${expected}, got ${JSON.stringify(normalizeTier(input))}`);
  }
}
// Everything else comes back verbatim, and `haiku` is the case this pins. It used to normalize to
// `cheap`, a tier .agents/rules/lifecycle.md no longer defines and .claude/workflows/tdd-cycle.js
// refuses to bind — so the mapping laundered a foreign token into tier vocabulary and produced a
// published tier that resolved to no model at all. Passthrough keeps a foreign token foreign.
// This must assert the contract rather than the current table: `cheap` is here to prove no alias
// RESOLVES to it either, which is the property the retirement actually bought.
for (const input of ['haiku', 'claude-haiku', 'cheap', 'gpt-5']) {
  if (normalizeTier && normalizeTier(input) !== input) {
    failures.push(`normalizeTier(${input}): expected the input back unchanged, got ${JSON.stringify(normalizeTier(input))} — only opus/sonnet are aliases, and none may resolve to a tier the runtime does not bind`);
  }
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
// `filesTouched` is per-phase and deliberately configurable: every phase reporting the same
// one file is what hid the review-scope narrowing below for as long as it existed.
async function renderCycle({
  notice,
  models,
  reviewScript,
  verifyFor,
  greenFiles = ['a.py'],
  refactorFiles = () => ['a.py'],
  securityTier = false,
  securityScript = () => ({ verdict: 'APPROVED', findings: [], skippedCategories: [] }),
  securityFixFiles = ['sec.py'],
}) {
  const calls = [];
  let review = 0;
  let security = 0;
  let refactorPass = 0;
  const respond = (label, opts) => {
    // A security-tier cycle whose plan says arch-review "none" halts before REVIEW, so the
    // security path is only reachable with the gate marked required.
    if (label === 'gate:read-plan') return { mode: securityTier ? 'required' : 'none', specSummary: 's', securityTier, noTdd: false, lockedDecisions: [] };
    if (label === 'gate:architect') return { verdict: 'GO', summary: 's', lockedDecisions: [] };
    if (label === 'red') return { testFiles: ['t.py'], failingCommand: 'p', failureLine: 'f', gateResult: 'Passed: 0 / Failed: 1' };
    if (label === 'green' || label === 'author') return { filesTouched: greenFiles, gateResult: 'Passed: 1 / Failed: 0', command: 'p', deviations: [] };
    if (label === 'refactor:security') return { filesTouched: securityFixFiles, gateResult: 'Passed: 1 / Failed: 0', command: 'p', deviations: [], resolutions: [{ finding: 'x', resolution: 'y' }] };
    if (label.startsWith('refactor:')) return { filesTouched: refactorFiles(refactorPass += 1), gateResult: 'Passed: 1 / Failed: 0', command: 'p', deviations: [], resolutions: [{ finding: 'x', resolution: 'y' }] };
    if (label.startsWith('review:pass-')) return reviewScript(review += 1);
    if (label.startsWith('security:pass-')) return securityScript(security += 1);
    if (label.startsWith('verify:')) return verifyFor(opts.lastBlocking);
    return {};
  };
  let lastBlocking = 0;
  const stubs = {
    args: {
      project: 'p', projectPath: 'projects/personal/p', plan: '001', cycle: '9.9', greenAgent: 'Python Expert',
      ...(notice ? { notice } : {}),
      // Spread on presence, not truthiness: `{ top: undefined }` is a real caller shape and the
      // one the tier guard exists for, so it must reach the workflow rather than be filtered here.
      ...(models !== undefined ? { models } : {}),
    },
    agent: async (prompt, opts = {}) => {
      const label = opts.label || '(unlabelled)';
      // `hasModel` separately from `model`: the defect being pinned is a model KEY that is present
      // with an undefined value, which `opts.model || null` would render indistinguishable from a
      // delegate that declares no tier at all (gate:read-plan is one).
      calls.push({
        label, prompt,
        agentType: opts.agentType || null,
        hasModel: Object.prototype.hasOwnProperty.call(opts, 'model'),
        model: opts.model,
      });
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

// The tier→model binding, which is the first thing the workflow does. `args.models` is the
// documented override channel and was spread over the defaults with nothing checking it, so three
// shapes reached `agent()` in silence: `{ top: undefined }` beat the default — spread copies an
// own key even when its value is undefined — and handed `model: undefined` to the architect gate
// AND the REVIEW gate; `{ top: 'haiku' }` bound both below the floor .agents/rules/lifecycle.md
// §Model capability tiers sets; and `{ cheap: … }`, the tier that used to exist, bound nothing at
// all while reading as though it had. None of them fails at the call site — the delegate just runs
// on whatever the harness defaults to — so a non-compliant verdict comes back looking exactly like
// a compliant one. The only place this is observable is the binding, so assert there.
{
  const approving = {
    securityTier: true, // gate:read-plan only reports the gate as required on a security-tier cycle
    reviewScript: () => ({ verdict: 'APPROVED', findings: [], skippedCategories: [] }),
    verifyFor: allVerdicts(false),
  };
  const rejects = async (label, models) => {
    const error = await renderCycle({ ...approving, models }).then(() => null, (e) => e);
    if (!error) failures.push(`TDD workflow: models ${label} was accepted — a binding outside { top, mid }, or one naming no model, must throw rather than reach agent()`);
  };
  await rejects('{ cheap: "haiku" }', { cheap: 'haiku' });
  await rejects('{ top: undefined }', { top: undefined });
  await rejects('{ top: "haiku" }', { top: 'haiku' });
  await rejects('{ mid: "" }', { mid: '' });

  // The other half, and it is what makes those four mean anything: a guard that rejected
  // everything would satisfy them all and break every real cycle. So every delegate that declares
  // a tier must receive a real model name, and the tiers must land where lifecycle.md puts them —
  // architect gate, REVIEW and security review at `top`, RED / GREEN / REFACTOR at `mid`. The
  // third case is the one that keeps the guard honest as models change: it must recognise a tier
  // that is BELOW the floor, not enumerate the model ids that are above it, or the next model
  // release breaks every override.
  const TIER_OF = { 'gate:architect': 'top', red: 'mid', green: 'mid', 'review:pass-1': 'top', 'security:pass-1': 'top' };
  const DEFAULTS = { top: 'opus', mid: 'sonnet' };
  for (const [label, models] of [
    ['default binding', undefined],
    ['explicit defaults', { top: 'opus', mid: 'sonnet' }],
    ['an unrecognised but compliant model id', { top: 'claude-opus-5', mid: 'claude-sonnet-5' }],
  ]) {
    const outcome = await renderCycle({ ...approving, models }).then((r) => r, (e) => e);
    if (outcome instanceof Error) {
      failures.push(`TDD workflow: ${label} was rejected at the binding — "${outcome.message.split(' — ')[0]}". A compliant override must run; the guard has to recognise a below-floor tier, not enumerate the model ids above it.`);
      continue;
    }
    const { calls } = outcome;
    for (const call of calls) {
      if (call.hasModel && !(typeof call.model === 'string' && call.model.trim())) {
        failures.push(`TDD workflow: ${label} handed model ${JSON.stringify(call.model)} to delegate ${call.label}`);
      }
    }
    for (const [callLabel, tier] of Object.entries(TIER_OF)) {
      const call = calls.find((c) => c.label === callLabel);
      if (!call) { failures.push(`TDD workflow: ${label} probe never reached ${callLabel}`); continue; }
      const want = (models || DEFAULTS)[tier];
      if (call.model !== want) {
        failures.push(`TDD workflow: ${label} ran ${callLabel} at ${JSON.stringify(call.model)}, expected the ${tier} tier (${want})`);
      }
    }
  }
}

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

// Read the scope back as JSON rather than substring-matching the prompt: a file named anywhere
// else in the preamble would otherwise pass for a file that is in scope.
const scopeOf = (prompt, pattern) => {
  const match = prompt.match(pattern);
  return match ? JSON.parse(match[1]) : null;
};
const REVIEW_SCOPE = /Files to review: (\[[^\]]*\])/;
const SECURITY_SCOPE = /^Files: (\[[^\]]*\])/m;
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A reviewer is only as good as the diff it is handed, and the scope accumulates while
// `lastReport` does not. Reassigning lastReport per pass narrowed the file list to whatever the
// newest REFACTOR touched: a cycle whose GREEN wrote a,b,c and whose REFACTOR touched only x had
// its APPROVING pass told to review [x] — and approved the whole cycle on that. Invisible while
// every phase stub reported the same ['a.py'], so give each phase a DISJOINT list. The expected
// lists are exact, not subsets: they pin the ORDER (running union) and the dedupe of a.py, which
// pass 2 touches for the second time.
{
  const { result, calls } = await renderCycle({
    greenFiles: ['a.py', 'b.py', 'c.py'],
    refactorFiles: (n) => (n === 1 ? ['a.py', 'x.py'] : ['y.py']),
    reviewScript: (n) => (n <= 2
      ? { verdict: 'NEEDS_FIX', findings: [blockingFinding(n)], skippedCategories: [] }
      : { verdict: 'APPROVED', findings: [], skippedCategories: [] }),
    verifyFor: allVerdicts(false), // confirmed, so each pass drives a REFACTOR
  });
  const expected = [
    ['a.py', 'b.py', 'c.py'],
    ['a.py', 'b.py', 'c.py', 'x.py'],
    ['a.py', 'b.py', 'c.py', 'x.py', 'y.py'],
  ];
  const scopes = calls.filter((c) => c.label.startsWith('review:pass-')).map((c) => scopeOf(c.prompt, REVIEW_SCOPE));
  if (scopes.length !== expected.length) {
    failures.push(`TDD workflow: review-scope probe ran ${scopes.length} passes, expected ${expected.length}`);
  }
  expected.forEach((want, i) => {
    if (!sameList(scopes[i], want)) {
      failures.push(`TDD workflow: review pass ${i + 1} was handed ${JSON.stringify(scopes[i])}, expected the running union ${JSON.stringify(want)}`);
    }
  });
  if (!result.approved) failures.push(`TDD workflow: review-scope probe did not approve (halted: ${result.halted})`);
}

// The security reviewer runs after the loop, so it inherited whatever `lastReport` last held:
// the general refactor's files on pass 1, and on pass 2 — the pass that approves a security-tier
// cycle — only the security remediation's own file, never the diff it was securing.
{
  const securityFinding = { tag: 'BLOCKER', finding: 'unbounded input', evidence: 'ran cmd; saw it', file: 'a.py' };
  const { result, calls } = await renderCycle({
    securityTier: true,
    greenFiles: ['a.py', 'b.py', 'c.py'],
    refactorFiles: () => ['x.py'],
    securityFixFiles: ['sec.py'],
    reviewScript: (n) => (n === 1
      ? { verdict: 'NEEDS_FIX', findings: [blockingFinding(1)], skippedCategories: [] }
      : { verdict: 'APPROVED', findings: [], skippedCategories: [] }),
    verifyFor: allVerdicts(false),
    securityScript: (n) => (n === 1
      ? { verdict: 'NEEDS_FIX', findings: [securityFinding], skippedCategories: [] }
      : { verdict: 'APPROVED', findings: [], skippedCategories: [] }),
  });
  const expected = [
    ['a.py', 'b.py', 'c.py', 'x.py'],
    ['a.py', 'b.py', 'c.py', 'x.py', 'sec.py'],
  ];
  const scopes = calls.filter((c) => c.label.startsWith('security:pass-')).map((c) => scopeOf(c.prompt, SECURITY_SCOPE));
  if (scopes.length !== expected.length) {
    failures.push(`TDD workflow: security probe ran ${scopes.length} passes, expected ${expected.length}`);
  }
  expected.forEach((want, i) => {
    if (!sameList(scopes[i], want)) {
      failures.push(`TDD workflow: security pass ${i + 1} was handed ${JSON.stringify(scopes[i])}, expected ${JSON.stringify(want)}`);
    }
  });
  if (!result.approved) failures.push(`TDD workflow: security-scope probe did not approve (halted: ${result.halted})`);
}

// The degenerate case of the same defect, and it was live rather than hypothetical: an
// implementer reporting filesTouched: [] rendered "Files to review: []", and the reviewer —
// having nothing to review — could only approve. The cycle then returned approved=true.
{
  const { result, calls } = await renderCycle({
    greenFiles: [],
    reviewScript: () => ({ verdict: 'APPROVED', findings: [], skippedCategories: [] }),
    verifyFor: allVerdicts(false),
  });
  if (result.halted !== 'empty-review-scope') {
    failures.push(`TDD workflow: an implementer report naming no files halted as ${result.halted} (approved: ${result.approved}), expected empty-review-scope`);
  }
  if (calls.some((c) => c.label.startsWith('review:pass-'))) {
    failures.push('TDD workflow: an implementer report naming no files still reached a reviewer');
  }
}

// PRE_SCHEMA is the contract between plan-batch and its own preflight delegate, and it used to
// reject the record its neutral spec defines: .agents/workflows/plan-batch.md §Preflight record
// names the roles greenRole / redRole, while the schema required `greenAgent` under
// additionalProperties:false — so a preflight that followed the written spec verbatim was thrown
// out by its own workflow ("must have required property 'greenAgent'" AND "must NOT have
// additional properties: greenRole"). Take the schema off the `agent()` call rather than
// restating it here: a copy in the test would only ever prove the copy.
async function planBatchPreflight() {
  const source = await readFile(path.join(repoRoot, '.claude/workflows/plan-batch.js'), 'utf8');
  let schema = null;
  const stubs = {
    args: { project: 'p', projectPath: 'projects/personal/p', plan: '001', batch: 'B1' },
    // ok:false halts the workflow on the next line, so nothing past the preflight runs.
    agent: async (_prompt, opts = {}) => {
      if (opts.label === 'preflight') schema = opts.schema;
      return { ok: false, cycles: [], testCollisionRisk: false, notes: 'probe' };
    },
    workflow: async () => ({}),
    parallel: (thunks) => Promise.all(thunks.map((thunk) => thunk())),
    phase: () => {},
    log: () => {},
  };
  const render = new Function(
    ...Object.keys(stubs),
    `return (async () => {\n${source.replace(/^export const meta/m, 'const meta')}\n})()`,
  );
  // Run first, then read `schema`: object properties evaluate left to right, so returning
  // `{ schema, result: await render(...) }` reads the capture before the workflow has filled it.
  const result = await render(...Object.values(stubs));
  return { schema, result };
}

if (Ajv) {
  const { schema, result } = await planBatchPreflight();
  if (result.halted !== 'preflight-failed') {
    failures.push(`plan-batch: an ok:false preflight halted as ${result.halted}, expected preflight-failed`);
  }
  if (!schema) {
    failures.push('plan-batch: the preflight delegate is called with no schema — its record reaches the run unvalidated');
  } else {
    const validate = new Ajv({ allErrors: true }).compile(schema);
    const record = (cycles) => ({ ok: true, testCollisionRisk: false, notes: '', cycles });
    for (const [label, value, want] of [
      // The spec's own spelling, and the adapter's. Both are the same record; the schema has to
      // agree with the document a delegate is told to follow.
      ['spec-shaped record (greenRole / redRole)', record([{ cycle: '4.1', greenRole: 'React Expert', redRole: 'Test Engineer', securityTier: false }]), true],
      ['adapter-shaped record (greenAgent / redAgent)', record([{ cycle: '4.1', greenAgent: 'React Expert', redAgent: 'Test Engineer', securityTier: false }]), true],
      // …and the alias must not have turned into permissiveness. A cycle naming NEITHER role is
      // exactly the failure the required-list exists to catch, and is what accepting two spellings
      // is easiest to break.
      ['cycle naming no implementation role', record([{ cycle: '4.1', securityTier: false }]), false],
      ['cycle missing securityTier', record([{ cycle: '4.1', greenRole: 'React Expert' }]), false],
      ['cycle missing its id', record([{ greenRole: 'React Expert', securityTier: false }]), false],
      ['unknown key on the cycle record', record([{ cycle: '4.1', greenRole: 'React Expert', securityTier: false, worktree: 'wt-1' }]), false],
      ['unknown key on the preflight record', { ...record([]), batchName: 'B1' }, false],
      ['ok returned as a string', { ...record([]), ok: 'yes' }, false],
      ['preflight record missing testCollisionRisk', { ok: true, notes: '', cycles: [] }, false],
    ]) {
      if (validate(value) === want) continue;
      failures.push(`plan-batch PRE_SCHEMA: ${label} should ${want ? 'validate' : 'be rejected'}` +
        (want ? ` — ajv said ${JSON.stringify(validate.errors)}` : ''));
    }
  }
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
