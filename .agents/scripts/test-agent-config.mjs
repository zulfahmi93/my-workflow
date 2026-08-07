#!/usr/bin/env node

import { access, chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
  // HEREDOCS. strip_heredoc_bodies() used to run only on the `except ValueError` retry, so on a
  // successful parse the raw command was segmented as-is — and `\n` separates segments, which
  // made every heredoc BODY LINE its own "invocation". Writing a policy note that says
  // "git commit --amend is forbidden" was itself blocked (see the pass list). These four are the
  // ways the fix for that could have been bought too cheaply, and each was measured going the
  // wrong way against a naive strip-always patch:
  //
  // A REAL over-length subject, taken through a heredoc substitution — the exact shape an
  // autonomous run writes, and the one the payload token is cut from.
  `git commit -m "$(cat <<'EOF'\nfeat(scope): ${'x'.repeat(60)}\n\nbody\nEOF\n)"`,
  // …and the same through bash -c. `raw` has to be threaded into the recursion or the body is
  // already gone by the time the nested call measures the subject.
  `bash -c 'git commit -m "$(cat <<EOF\nfeat(scope): ${'x'.repeat(60)}\nEOF\n)"'`,
  // A stray `<<` in quoted prose reads as a heredoc opener for delimiter `b`. Stripping to
  // end-of-input when no terminator is found deleted the rest of the command — a live --amend
  // bypass, one line below.
  'echo "a << b"\ngit commit --amend',
  // Genuinely unterminated: there is no delimiter line, so nothing may be swallowed.
  "cat <<'EOF'\nprose\ngit commit --amend",
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
  // The blocker itself: a heredoc body is PROSE. Documenting the policy — which is what the
  // rules, the plan YAMLs and every AUTONOMOUS_RUN_STATUS.md do — must not be an offence.
  // Every forbidden form has to be quotable, not just the first one anybody tried.
  "cat > /tmp/n.md <<'EOF'\ngit commit --amend is forbidden by policy\nEOF",
  "cat > /tmp/n.md <<'EOF'\ngit push --force is forbidden by policy\ngh pr create is forbidden by policy\nEOF",
  // Including an over-length `-m` subject: still prose, still exit 0. This is the case the
  // brief phrased as "must still block"; measured, that reading is the false block being fixed —
  // what must still block is a REAL heredoc-substitution commit, and that is in the block list.
  `cat > /tmp/n.md <<'EOF'\ngit commit -m "feat(scope): ${'x'.repeat(60)}"\nEOF`,
  // Doc-then-commit sharing one delimiter, which is what a cycle writes every time: the note's
  // first line must not be measured as the commit's subject. heredoc_body_from_raw() took the
  // FIRST match, so a 71-char note line convicted a short, legal commit.
  `cat > n.md <<'EOF'\n${'x'.repeat(71)}\nEOF\ngit commit -m "$(cat <<EOF\nfix(a): short\nEOF\n)"`,
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

// The terminal half of the same policy, and it had NO behavioural test at all: the file-editing
// hooks above guard `*/docs/html/*`, while `cat > …/docs/html/i.html` went straight past. #20 is
// the case that named the hole — `echo x >projects/…/docs/html/index.html`, no space after the
// operator, so shlex lexed `>docs/html/…` as ONE word, no redirect pattern matched, exit 0, and
// `npm run build` erased the hand-edit with no record of either event. Both directions matter
// equally: this policy fires on every Bash call an agent makes, so a false block is not a
// nuisance, it is a thing agents learn to route around.
const generatedCommandPolicy = path.join(repoRoot, '.agents/scripts/check-generated-command.py');
const generatedFile = 'docs/html/index.html';
for (const command of [
  // #20 and its whole family — the operator forms that all lexed as one word.
  `echo x >${generatedFile}`,
  `echo x > ${generatedFile}`,
  `echo x >>${generatedFile}`,
  `echo x 1>${generatedFile}`,
  `echo x &>${generatedFile}`,
  `echo x >| ${generatedFile}`,
  // Absolute, and behind a control operator: a segment separator must still separate, which is
  // why the redirect characters are punctuation to the lexer but excluded from CONTROL.
  `echo x >${path.join(repoRoot, generatedFile)}`,
  `npm run build >/tmp/log 2>&1 && cp /tmp/a ${generatedFile}`,
  // The non-redirect write positions, each with a trailing redirect so the lexer change is
  // exercised rather than bypassed.
  `sed -i '' s/a/b/ ${generatedFile}`,
  `tee ${generatedFile} </tmp/x`,
  // Lexical wrappers — the same silent write-through as #20, reached by hiding the redirect
  // inside a quoted payload instead of by missing punctuation. All four measured at exit 0
  // before the payload recursion landed, i.e. a complete bypass of the one rule this policy
  // exists to enforce. The nesting case pins the recursion, not just the top level.
  `bash -c 'echo pwned > ${generatedFile}'`,
  `sh -c "echo pwned > ${generatedFile}"`,
  `eval "echo hack > ${generatedFile}"`,
  `bash -c 'bash -c "echo x > ${generatedFile}"'`,
  // Exec wrappers hide the COMMAND WORD, not the redirect (the outer shell parses that), so
  // these need the tee/cp/sed/truncate rules to see past the wrapper. Each was exit 0 before.
  `nohup cp /tmp/x.html ${generatedFile}`,
  `env FOO=bar tee ${generatedFile}`,
  `timeout 30 cp /tmp/x.html ${generatedFile}`,
  `nice -n 5 mv /tmp/x.html ${generatedFile}`,
  `sudo truncate -s 0 ${generatedFile}`,
]) {
  expectStatus(`blocked generated write: ${command}`, run('python3', [generatedCommandPolicy, command]), 2);
}
for (const command of [
  // Ordinary redirects, including the fd forms that `&`+`>` as punctuation newly fuses into one
  // token (`>&`, `2>&1`). Blocking any of these breaks routine work.
  'echo x >/tmp/foo',
  'npm test >out.log 2>&1',
  'echo boom >&2',
  'echo x 2>&1 >/tmp/out',
  `ls ${path.dirname(generatedFile)}/ 2>/dev/null`,
  // READING generated output is fine, and reads are how it is inspected. `<` had to become
  // punctuation too, or its operand fell through to the tee/cp operand rules as a write target.
  `cat ${generatedFile}`,
  `grep -rn foo ${path.dirname(generatedFile)}/`,
  `cp ${generatedFile} /tmp/backup.html`,
  `tee /tmp/copy <${generatedFile}`,
  // Spaced, which is the form that was already false-blocking before `<` became punctuation:
  // the operand fell through to tee's "every operand is a target" rule and a pure READ was
  // reported as a write.
  `tee /tmp/copy < ${generatedFile}`,
  `truncate -s 0 /tmp/x < ${generatedFile}`,
  // Merely NAMING the path is not writing to it, and the write here lands somewhere else.
  `echo "see ${generatedFile}" > /tmp/notes.md`,
  'echo x >docs/templates/adr.md',
  // Unresolvable, so unblocked by design: the real target is not knowable statically.
  `echo x >$OUT/${generatedFile}`,
  `echo 'unterminated > ${generatedFile}`,
  // The wrapper resolution above must not over-block: a wrapped READ is still a read, and a
  // wrapped write that lands ELSEWHERE is still fine. Without these the payload recursion is
  // satisfiable by blocking every `bash -c`, which would stop routine work outright.
  `bash -c 'cat ${generatedFile}'`,
  `bash -c 'npm run build'`,
  `eval 'cat ${generatedFile}'`,
  `bash -c 'echo "see ${generatedFile}" > /tmp/notes.md'`,
  `nohup cp ${generatedFile} /tmp/backup.html`,
  `timeout 30 cp ${generatedFile} /tmp/backup.html`,
  `nohup tee /tmp/copy < ${generatedFile}`,
  'bash --version',
  'bash /tmp/script.sh',
]) {
  expectStatus(`allowed generated-path command: ${command}`, run('python3', [generatedCommandPolicy, command]), 0);
}

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

// The PLAN branch of the same hook, which was blind for exactly the session that matters. It ran
// a bare `npm run validate`, which walks projects.config.json — so it never opened the file that
// had just been written unless that file was already registered, and docs-site.md §Onboarding
// puts "author plan-NNN.yaml" at step 1 and "add { id } to projects.config.json" at step 2. A new
// plan is unregistered for its whole authoring session: hundreds of lines written against a green
// hook, every violation arriving at once at registration.
//
// The fixture lands in the root repo's own `docs/`, excluded by .gitignore:26 (`/docs/*`), so the
// probe leaves no git dirt. It has to sit INSIDE the repo root — the hook deliberately ignores
// anything outside it — and outside every registered docsRoot, which is what makes it the
// unregistered case. Gated on tools/docs-gen/node_modules because the hook's own documented
// behaviour without it is to skip loudly at exit 0.
if (await access(path.join(repoRoot, 'tools/docs-gen/node_modules')).then(() => true).catch(() => false)) {
  const docsValidator = path.join(repoRoot, '.agents/scripts/validate-docs-yaml.sh');
  const probe = path.join(repoRoot, 'docs', `plan-999-hook-probe-${process.pid}.yaml`);
  const cycle = [
    'cycles:', '  - id: "9.9"', '    title: a cycle', '    primary: [test-engineer]',
    '    arch-review:', '      state: none', '    status: idle', '',
  ];
  try {
    await writeFile(probe, ['id: "999"', 'project: probe', 'title: probe', 'bogus-key: yes', ...cycle].join('\n'));
    const rejected = run(docsValidator, [probe]);
    expectStatus('unregistered plan carrying a schema violation', rejected, 2);
    if (!rejected.stderr.includes('bogus-key')) {
      failures.push(`unregistered plan carrying a schema violation: the report does not name it — ${JSON.stringify(rejected.stderr)}`);
    }
    // The counterweight, and it is what stops the fix from being "reject everything unregistered":
    // the same file, valid, must pass. Authoring a new plan cannot become impossible.
    await writeFile(probe, ['id: "999"', 'project: probe', 'title: probe', ...cycle].join('\n'));
    expectStatus('unregistered plan that is valid', run(docsValidator, [probe]), 0);
  } finally {
    await rm(probe, { force: true });
  }
}

// install-git-hooks.sh has claimed idempotence in its header since day one while `cat >` overwrote
// unconditionally, so installing into a repo that already had a pre-commit (husky, lefthook, a
// hand-rolled linter) destroyed it silently — and this installer is the only thing that arms the
// docs-YAML gate in the nested repos, so it gets run by whoever notices, against repos they did
// not set up.
//
// Driven against a throwaway root: the script resolves `root` from its OWN location and bakes it
// into the hooks it writes, so a copy under /tmp installs into /tmp and cannot reach a live repo.
// Nothing here stages or commits — `git init` and the hook files on disk are the whole surface.
{
  const fake = await mkdtemp(path.join(os.tmpdir(), 'agent-config-hooks-'));
  try {
    await mkdir(path.join(fake, '.agents/scripts'), { recursive: true });
    const installer = path.join(fake, '.agents/scripts/install-git-hooks.sh');
    await copyFile(path.join(repoRoot, '.agents/scripts/install-git-hooks.sh'), installer);
    // Two groups, mirroring projects/<group>/<name>: the walk is `projects/*/*`, so a fixture
    // one level shallower would pass while the real layout was skipped.
    const keeper = path.join(fake, 'projects/personal/keeper');
    const fresh = path.join(fake, 'projects/rintis/fresh');
    for (const dir of [fake, keeper, fresh]) {
      await mkdir(dir, { recursive: true });
      run('git', ['init', '-q'], { cwd: dir });
      // A machine with init.templateDir set would otherwise seed a pre-commit and the refusal
      // below would fire for the wrong reason.
      await rm(path.join(dir, '.git/hooks/pre-commit'), { force: true });
    }
    const foreign = '#!/bin/sh\n# my precious husky hook\nexit 0\n';
    const keeperHook = path.join(keeper, '.git/hooks/pre-commit');
    const freshHook = path.join(fresh, '.git/hooks/pre-commit');
    await writeFile(keeperHook, foreign);

    for (const pass of ['first run', 're-run']) {
      const install = run('bash', [installer]);
      expectStatus(`install-git-hooks (${pass})`, install, 0);
      // Refusing must be a SKIP, not an abort: one foreign hook cannot cost the other repos
      // their gate, or the fix trades a silent clobber for a silent non-install.
      if (!install.stderr.includes('skipped')) {
        failures.push(`install-git-hooks (${pass}): refused silently — the author is never told why ${keeperHook} was left alone`);
      }
      if ((await readFile(keeperHook, 'utf8')) !== foreign) {
        failures.push(`install-git-hooks (${pass}): overwrote a pre-commit hook it did not generate`);
      }
      if (!(await readFile(freshHook, 'utf8').catch(() => '')).includes('Generated by .agents/scripts/install-git-hooks.sh')) {
        failures.push(`install-git-hooks (${pass}): the foreign hook stopped the walk — ${freshHook} was never installed`);
      }
      if (!(await readFile(path.join(fake, '.git/hooks/pre-commit'), 'utf8').catch(() => '')).includes('validate-agent-config.mjs')) {
        failures.push(`install-git-hooks (${pass}): the root repo's agent-config gate was not installed`);
      }
    }
  } finally {
    await rm(fake, { recursive: true, force: true });
  }
}

// A cycle's `primary[]` and `arch-review.reviewer` name the role that cycle dispatches to, and
// nothing checked those names against the roles that exist: 13 of 249 entries resolved to nothing
// — ten `ui-ux-expert` for a role file called `uiux-expert`, three carrying a parenthetical gloss
// — each naming a specialist owner no orchestrator could look up.
//
// validate-agent-config.mjs resolves its repo root from its own file location, so this can only be
// driven against a TREE. Mirror the root: a real .agents/scripts holding a COPY of the validator
// (a symlink resolves to its real path, and the validator would then check the live repo instead),
// symlinks for everything else it reads, and a projects/ holding two fixture plans. Assert on the
// MESSAGE, never on exit 1 alone — an exit code says nothing about which file was named, and a
// check that cannot point at the cycle is a check nobody can act on.
//
// The same fixture also carries the primary[]/agentType BRIDGE and the root guide's project
// enumeration, because both need exactly this tree — a mutable `.agents/roles/`, a mutable
// `.claude/agents/`, a mutable AGENTS.md and a projects/ of its own — and a validator spawn here
// costs ~1.3s. The validator accumulates errors rather than exiting on the first, so one run
// covers all of them and every assertion is on the MESSAGE.
{
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'agent-config-planrefs-'));
  try {
    // A real directory whose entries are symlinks back to the repo, except `copies`, which are
    // real files so they can be mutated without touching the live tree, and `real`, which a later
    // call materialises the same way. A symlinked SCRIPT would be worse than useless: Node
    // resolves a module to its realpath, so the validator would resolve its repo root back to the
    // live repo and the fixture would quietly test nothing.
    const mirrorDir = async (rel, { copies = [], real = [] } = {}) => {
      await mkdir(path.join(fixture, rel), { recursive: true });
      for (const entry of await readdir(path.join(repoRoot, rel))) {
        if (real.includes(entry)) continue;
        const from = path.join(repoRoot, rel, entry);
        const to = path.join(fixture, rel, entry);
        if (copies.includes(entry)) await copyFile(from, to);
        else await symlink(from, to);
      }
    };
    await mirrorDir('.agents', { real: ['scripts', 'roles'] });
    await mirrorDir('.agents/scripts', { copies: ['validate-agent-config.mjs'] });
    await mirrorDir('.agents/roles', { copies: ['technical-writer.md', 'api-designer.md'] });
    await mirrorDir('.claude', { real: ['agents'] });
    await mirrorDir('.claude/agents', { copies: ['technical-writer.md', 'api-designer.md'] });
    // projects/ is the one thing that must NOT be symlinked: the fixture plans live there, and
    // the real corpus would drown the assertion in its own (correct) contents.
    for (const entry of ['.codex', 'tools', 'wiki', 'docs', 'CLAUDE.md']) {
      await symlink(path.join(repoRoot, entry), path.join(fixture, entry));
    }

    // The bridge mutations. Both are applied to the canonical role AND its Claude adapter, so the
    // pre-existing routing-frontmatter parity check stays satisfied and the new checks are the
    // only thing that can report them — a mutation another check already catches proves nothing
    // about the one under test.
    //   · technical-writer: `name:` blanked. That field IS the `agentType` a delegate is spawned
    //     as, and blanking it left both gates at exit 0 (measured), because `/^name:\s*(.+)$/m`
    //     skipped the empty value and captured the DESCRIPTION line instead.
    //   · api-designer: given AI Engineer's display name. `agentType` dispatches on it, so two
    //     roles sharing one cannot be told apart in either direction.
    for (const dir of ['.agents/roles', '.claude/agents']) {
      for (const [file, line] of [['technical-writer.md', 'name:'], ['api-designer.md', 'name: AI Engineer']]) {
        const at = path.join(fixture, dir, file);
        await writeFile(at, (await readFile(at, 'utf8')).replace(/^name: .*$/m, line));
      }
    }

    // The root guide. Its §Layout fence enumerated projects until 2026-08-07 and drifted five
    // deleted / four missing, in the file CLAUDE.md imports into every session. The prose half
    // covers the other way a dead name survives here — a concrete path reference outside the
    // fence — and the third line is the counterweight: a REGISTERED project that is simply not
    // checked out is correctly named, and must not be reported.
    const guide = (await readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8')).replace(
      '  personal/               # personal projects',
      [
        '  personal/               # personal projects',
        '    ai-receipt-maker/     # receipt PDF generator (.NET)',
        '    tunas-lite/           # WhatsApp clock-in demo',
        // At the SAME indent as the group dirs. A rule anchored on the shallowest entry's depth
        // alone reads this as compliant, which is how a fence that drops its group lines entirely
        // and lists projects directly would slip through.
        '  duitnow-demo/           # DuitNow payments app',
      ].join('\n'),
    );
    if (guide === await readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8')) {
      failures.push('root guide fixture: the §Layout fence no longer has a `personal/` group line to enumerate under — the mutation applied nothing and the case proves nothing');
    }
    await writeFile(path.join(fixture, 'AGENTS.md'), `${guide}\nSee projects/personal/ballot-counter/docs/plan-002.yaml and projects/personal/susun-jadual/docs/plan-001.yaml.\n`);

    const fixtureDocs = path.join(fixture, 'projects/personal/fixture/docs');
    await mkdir(fixtureDocs, { recursive: true });
    await writeFile(path.join(fixtureDocs, 'plan-001.yaml'), [
      'id: "001"', 'project: fixture', 'title: Agent-reference fixture', 'cycles:',
      '  - id: "9.9"', '    title: names an implementation role that does not exist',
      '    primary:', '      - no-such-role',
      '    arch-review:', '      state: none', '    status: idle',
      '  - id: "9.8"', '    title: names a reviewer that does not exist',
      '    primary:', '      - test-engineer',
      '    arch-review:', '      state: required', '      tier: top', '      reviewer: no-such-reviewer',
      '    status: idle',
      // Resolves as a stem, so the pre-existing check is silent on it — and dispatches to an
      // empty agentType, which is what the bridge check is for.
      '  - id: "9.6"', '    title: names a role that resolves but cannot be dispatched',
      '    primary:', '      - technical-writer',
      '    arch-review:', '      state: none', '    status: idle', '',
    ].join('\n'));
    await writeFile(path.join(fixtureDocs, 'plan-002.yaml'), [
      'id: "002"', 'project: fixture', 'title: Every role resolves', 'cycles:',
      '  - id: "9.7"', '    title: a well-formed cycle',
      '    primary:', '      - uiux-expert',
      '    arch-review:', '      state: required', '      tier: top', '      reviewer: software-architect',
      '    status: idle', '',
    ].join('\n'));

    const refs = run('node', [path.join(fixture, '.agents/scripts/validate-agent-config.mjs')], { cwd: fixture });
    const output = `${refs.stderr}${refs.stdout}`;
    if (refs.status !== 1) failures.push(`plan agent refs: expected exit 1, got ${refs.status}\n${output}`);
    for (const want of [
      'projects/personal/fixture/docs/plan-001.yaml: cycle 9.9: primary "no-such-role" is not a role in .agents/roles/',
      'projects/personal/fixture/docs/plan-001.yaml: cycle 9.8: arch-review.reviewer "no-such-reviewer" is not a role in .agents/roles/',
      // The bridge: a stem that resolves to a role carrying no display name, reported against the
      // cycle that would dispatch it rather than only against the role file.
      '.agents/roles/technical-writer.md declares no display name',
      'projects/personal/fixture/docs/plan-001.yaml: cycle 9.6',
      // …and the vocabulary itself: display names have to be unique to be reversible.
      '.agents/roles/api-designer.md: display name "AI Engineer" is already used by ai-engineer.md',
      // The root guide, both halves.
      '§Layout enumerates project "ai-receipt-maker"',
      '§Layout enumerates project "tunas-lite"',
      '§Layout enumerates project "duitnow-demo"',
      'names project "ballot-counter", which is neither on disk',
    ]) {
      if (!output.includes(want)) failures.push(`plan agent refs: nothing reported ${JSON.stringify(want)}\n${output}`);
    }
    // The other direction: `uiux-expert` is the real spelling of the role the corpus kept getting
    // wrong, so a check that flagged it too would be worse than none.
    if (output.includes('plan-002.yaml')) {
      failures.push(`plan agent refs: reported a plan whose roles all resolve\n${output}`);
    }
    // A project in projects.config.json but not checked out here. Naming it is correct, and a
    // disk-only check would report every registered project the moment `projects/` is a worktree.
    if (output.includes('susun-jadual')) {
      failures.push(`root guide: reported a registered project that is simply not checked out\n${output}`);
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

// The review-family model floor. Same fixture shape as the plan-agent-refs block above and for
// the same reason — validate-agent-config.mjs resolves its root from its own location, so the
// only way to drive it against a mutated adapter is to give it a tree where that adapter is a
// real file. `.claude/agents/<one file>` is the copy; everything else is a symlink.
//
// This exists because `model:` sat exactly where `tools:` sat: preserved from disk by
// sync-claude-adapters.mjs, derived from nothing, checked by nobody. Setting code-reviewer.md to
// `model: haiku` left BOTH gates byte-identical in output and exit code, so a REVIEW verdict
// could be produced at a tier lifecycle.md says may never produce one and every gate stayed
// green. Both directions are asserted: a check that rejected `sonnet` on finding-verifier too
// would misreport the one adapter that is CORRECTLY below `top`.
{
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'agent-config-tier-'));
  try {
    await mkdir(path.join(fixture, '.agents/scripts'), { recursive: true });
    await mkdir(path.join(fixture, '.claude/agents'), { recursive: true });
    for (const entry of await readdir(path.join(repoRoot, '.agents'))) {
      if (entry !== 'scripts') await symlink(path.join(repoRoot, '.agents', entry), path.join(fixture, '.agents', entry));
    }
    for (const entry of await readdir(path.join(repoRoot, '.agents/scripts'))) {
      const from = path.join(repoRoot, '.agents/scripts', entry);
      const to = path.join(fixture, '.agents/scripts', entry);
      if (entry === 'validate-agent-config.mjs') await copyFile(from, to);
      else await symlink(from, to);
    }
    for (const entry of await readdir(path.join(repoRoot, '.claude'))) {
      if (entry !== 'agents') await symlink(path.join(repoRoot, '.claude', entry), path.join(fixture, '.claude', entry));
    }
    // All three floored adapters are mutated in ONE validator run. The validator accumulates
    // errors rather than exiting on the first, so one spawn covers all three floors — and a
    // spawn costs ~1.3s here, so a run per case doubled the whole suite's wall time for no
    // extra coverage. It also pins that the floor is wired for all three roles, not just one.
    const floored = ['code-reviewer.md', 'security-reviewer.md', 'finding-verifier.md'];
    for (const entry of await readdir(path.join(repoRoot, '.claude/agents'))) {
      if (!floored.includes(entry)) await symlink(path.join(repoRoot, '.claude/agents', entry), path.join(fixture, '.claude/agents', entry));
    }
    // projects/ is deliberately NOT linked. This fixture is about adapters, and the validator
    // runs four times here — pointing it at the real corpus made each run re-parse all 14 plan
    // YAMLs and doubled the whole suite's wall time. Its absence is the documented graceful skip
    // (root-only checkout / worktree), so leaving it out exercises that path for free.
    for (const entry of ['.codex', 'tools', 'wiki', 'docs', 'AGENTS.md', 'CLAUDE.md']) {
      await symlink(path.join(repoRoot, entry), path.join(fixture, entry));
    }
    const shipped = {};
    for (const entry of floored) shipped[entry] = await readFile(path.join(repoRoot, '.claude/agents', entry), 'utf8');
    const validator = path.join(fixture, '.agents/scripts/validate-agent-config.mjs');

    // Unmutated first: the floor must not fire on the adapters as they ship, or every assertion
    // below is satisfiable by a check that rejects everything. finding-verifier's `sonnet` is the
    // one that matters here — it is CORRECTLY below `top`, and a flat floor would flag it.
    for (const entry of floored) await writeFile(path.join(fixture, '.claude/agents', entry), shipped[entry]);
    const clean = run('node', [validator], { cwd: fixture });
    if (clean.status !== 0) {
      failures.push(`model floor: shipped adapters must pass, got ${clean.status}\n${clean.stderr}${clean.stdout}`);
    }

    // One run, three shapes: a RETIRED token, a REAL tier that is simply below this role's floor,
    // and an ABSENT line. The middle one is what separates a rank compare from a haiku denylist;
    // the last one matters because a missing `model:` is not "no opinion", it is an unpinned tier
    // that runs at whatever the harness defaults to.
    await writeFile(path.join(fixture, '.claude/agents/code-reviewer.md'), shipped['code-reviewer.md'].replace(/^model: .*$/m, 'model: sonnet'));
    await writeFile(path.join(fixture, '.claude/agents/security-reviewer.md'), shipped['security-reviewer.md'].replace(/^model: .*$/m, 'model: haiku'));
    await writeFile(path.join(fixture, '.claude/agents/finding-verifier.md'), shipped['finding-verifier.md'].replace(/^model: .*\n/m, ''));
    const bad = run('node', [validator], { cwd: fixture });
    const out = `${bad.stderr}${bad.stdout}`;
    if (bad.status !== 1) failures.push(`model floor: expected exit 1, got ${bad.status}\n${out}`);
    for (const want of [
      '.claude/agents/code-reviewer.md: model sonnet is below the top floor',
      '.claude/agents/security-reviewer.md: model haiku is below the top floor',
      '.claude/agents/finding-verifier.md: review-family role declares no model',
    ]) {
      if (!out.includes(want)) failures.push(`model floor: nothing reported ${JSON.stringify(want)}\n${out}`);
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
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
    // Cycle 1.2 is the drift fixture: its session prompt restates the gate as "REQUIRED (sonnet)"
    // while the runtime gates every required review at the top tier regardless, so the rendered
    // declaration must follow `arch-review`, not the prose.
    //
    // It USED to declare `tier: mid` as well, because `tier` enumed top|mid|opus|sonnet and a
    // below-floor value was therefore schema-valid — which is exactly how 40 real cycles came to
    // advertise a mid-tier architect gate that never ran. That enum is now [top, opus], so
    // structured drift is unrepresentable and only the unconstrained prompt string can still drift.
    // `tier: opus` is the surviving half of the fixture; `meta-raw` covers the same shape on a
    // phase whose runtime tier is likewise fixed.
    await writeFile(path.join(presentDocs, 'plan-001.yaml'), [
      'id: "001"', 'project: present', 'title: Fixture plan', 'cycles:',
      '  - id: "1.1"', '    title: A cycle', '    primary: [Test Engineer]',
      '    arch-review:', '      state: none', '    status: idle',
      '  - id: "1.2"', '    title: A gated cycle', '    primary: [Test Engineer]',
      '    arch-review:', '      state: required', '      tier: opus', '      reviewer: Test Engineer',
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
    // Architect-gate deferral chains, which are cross-FILE by nature: `state: deferred` means
    // "inherit the target cycle's verdict", and a target may live in an earlier PLAN of the same
    // project (kobu-bot 004.3 → 002.10). validate-source.mjs only ever sees one file, so nothing
    // could resolve a target at all — kobu-bot 004.10, the live production smoke on a paying
    // client's WABA, sat deferred to a cycle for as long as the plan existed while `npm run
    // validate` called the file valid. Three ways to inherit nothing, and the legitimate case
    // that must keep passing.
    const deferral = (target) => [
      'id: "002"', 'project: present', 'title: Deferral fixture', 'cycles:',
      '  - id: "2.1"', "    title: Inherits an earlier plan's verdict",
      '    primary: [test-engineer]',
      '    arch-review:', '      state: deferred', `      deferred-to: "${target}"`,
      '    status: idle', '',
    ].join('\n');
    const plan002 = path.join(presentDocs, 'plan-002.yaml');
    await writeFile(plan002, deferral('1.2'));
    await writeRegistry([entry('present', [{ id: '001' }, { id: '002' }]), entry('ghost', [{ id: '001' }])]);
    expectStatus('docs-gen validate: cross-plan deferral onto a required gate', run('node', [generate, '--validate']), 0);
    for (const [label, target] of [
      // The kobu-bot 004.10 shape: the target exists, and its own gate is `none` — there is no
      // verdict there to inherit. Anything but `required` is the same nothing.
      ['a gate marked none', '1.1'],
      ['a cycle id that matches nothing in the project', '9.9'],
    ]) {
      await writeFile(plan002, deferral(target));
      const dangling = run('node', [generate, '--validate']);
      expectStatus(`docs-gen validate: deferral onto ${label}`, dangling, 1);
      const said = `${dangling.stderr}${dangling.stdout}`;
      if (!said.includes('2.1') || !said.includes(target)) {
        failures.push(`docs-gen validate: deferral onto ${label} failed without naming the cycle and its target\n${said}`);
      }
    }
    // Restore, so the registry-typo case below still fails for the typo and not for this.
    await writeFile(plan002, deferral('1.2'));

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

// `phases.*.meta-raw` is what the site PUBLISHES about a phase — load-yaml-source.mjs prefers it
// over the enum-checked `agent` — and 56daa74 closed `model` against the retired cheap tier while
// leaving this string wide open. After 25e8613 made the tier a runtime constant that is worse than
// a downgrade, not better: stripDeclaredTier() drops a leading token only when it normalizes to
// top|mid, so a cheap one SURVIVES and the phase card renders "`top` — `haiku` — `code-reviewer`",
// advertising a reviewer lifecycle.md §Model capability tiers says may never produce a REVIEW
// verdict, right beside the tier the runtime actually pays. Driven through validate-source.mjs
// rather than a hand-wired ajv so it reads the same schema file the build does.
if (normalizeTier) {
  const { validateDoc } = await import('../../tools/docs-gen/lib/validate-source.mjs');
  const withMeta = (meta) => ({
    id: '001', project: 'p', title: 't',
    cycles: [{
      id: '1.1', title: 'c', primary: ['test-engineer'], 'arch-review': { state: 'none' }, status: 'idle',
      phases: { review: { 'meta-raw': meta } },
    }],
  });
  for (const [meta, valid] of [
    ['`haiku` — `code-reviewer`', false],
    ['`cheap` — `code-reviewer`', false],
    // What the renderer actually emits from the first one — the two tiers side by side.
    ['`top` — `haiku` — `code-reviewer`', false],
    ['`opus` — `code-reviewer`', true],
    // Unbackticked, so not a designation. Backticks are this corpus's convention for naming a
    // model, and prose about the policy has to stay writable — same principle as the heredoc
    // bodies in the commit gate above.
    ['Reviewed at top, never haiku.', true],
  ]) {
    let rejected = false;
    try { validateDoc(withMeta(meta), 'meta-raw fixture'); } catch { rejected = true; }
    if (rejected !== !valid) {
      failures.push(`plan.schema.json meta-raw ${JSON.stringify(meta)}: expected it to ${valid ? 'validate' : 'be rejected'}`);
    }
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
  // Budget overrides (`maxReviewPasses`, `maxRefutedOnlyPasses`) reach the workflow only through
  // args, so they cannot be probed without a channel for arbitrary caller args.
  extraArgs = {},
  // Labels whose delegate returns null — a subagent that dies mid-cycle. The whole point of the
  // structured-halt work is that this is a RETURN, not a throw, so it has to be drivable.
  dieAt = [],
}) {
  const calls = [];
  const dead = new Set(dieAt);
  let review = 0;
  let security = 0;
  let verify = 0;
  let refactorPass = 0;
  const respond = (label, opts) => {
    if (dead.has(label)) return null;
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
    // The verifier gets the pass ordinal too: a reviewer that ALTERNATES between real and
    // hallucinated findings is the shape the cumulative refuted budget exists for, and it cannot
    // be scripted from the blocking count alone.
    if (label.startsWith('verify:')) return verifyFor(opts.lastBlocking, verify += 1);
    return {};
  };
  let lastBlocking = 0;
  const stubs = {
    args: {
      project: 'p', projectPath: 'projects/personal/p', plan: '001', cycle: '9.9', greenAgent: 'Python Expert',
      ...extraArgs,
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
        // `result &&`: a dead delegate returns null, which is the case dieAt drives.
        lastBlocking = ((result && result.findings) || []).filter((f) => f.tag === 'BLOCKER' || f.tag === 'REFACTOR').length;
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

// The refuted-only budget must be CUMULATIVE over the cycle, not per productive pass. It was
// reset to 0 on every pass that produced a confirmed finding, which made the two budgets multiply
// instead of add: a reviewer alternating one real finding with one hallucinated one never
// accumulated 3 refuted-only passes, so it ran the productive budget out at 6 and only halted at
// `review-not-approved` — 18 REVIEW + 18 VERIFY + 6 REFACTOR = 45 delegate spawns, at `top` tier
// for every review. The bound the workflow documents is MAX_REVIEW_PASSES + MAX_REFUTED_ONLY = 9
// review passes, so assert the CEILING rather than an exact count: the point is that it is
// bounded by the sum, and pinning 4 would break the moment either default moves.
{
  const { result, calls } = await renderCycle({
    // Odd pass: a real finding, confirmed, which drives a REFACTOR. Even pass: a hallucination,
    // refuted. Under the reset the even passes cost nothing and the loop runs to the far bound.
    reviewScript: () => ({ verdict: 'NEEDS_FIX', findings: [blockingFinding(1)], skippedCategories: [] }),
    verifyFor: (_lastBlocking, verifyPass) => allVerdicts(verifyPass % 2 === 0)(1),
  });
  const reviews = calls.filter((c) => c.label.startsWith('review:pass-')).length;
  if (result.halted !== 'reviewer-hallucination-loop') {
    failures.push(`TDD workflow: an alternating reviewer halted as ${result.halted} after ${reviews} passes, expected reviewer-hallucination-loop — the refuted-only budget is being reset by a productive pass, so the two budgets multiply instead of adding`);
  }
  if (reviews > 9) {
    failures.push(`TDD workflow: an alternating reviewer ran ${reviews} review passes — the documented ceiling is maxReviewPasses + maxRefutedOnlyPasses = 9`);
  }
  if (calls.filter((c) => c.label.startsWith('verify:')).length !== reviews) {
    failures.push('TDD workflow: alternating-reviewer probe did not run exactly one verifier per review pass');
  }
}

// `0` on either budget means "no passes allowed", and it must halt BEFORE the first delegate of
// that loop. `||` read an explicit 0 as unset and restored the default, so a caller disabling the
// loop got the most expensive path there is — six `top`-tier review passes. Both budgets, because
// they are read through the same helper and one of them being right proves nothing about the
// other. The malformed shapes are argument errors and must throw: nothing has run yet.
{
  const approving = {
    reviewScript: () => ({ verdict: 'APPROVED', findings: [], skippedCategories: [] }),
    verifyFor: allVerdicts(false),
  };
  for (const [label, extraArgs, halted] of [
    ['maxReviewPasses: 0', { maxReviewPasses: 0 }, 'review-not-approved'],
    ['maxRefutedOnlyPasses: 0', { maxRefutedOnlyPasses: 0 }, 'reviewer-hallucination-loop'],
  ]) {
    const { result, calls } = await renderCycle({ ...approving, extraArgs });
    if (result.halted !== halted) {
      failures.push(`TDD workflow: ${label} halted as ${result.halted} (approved: ${result.approved}), expected ${halted} — 0 is a budget, not an unset key`);
    }
    const reviews = calls.filter((c) => c.label.startsWith('review:pass-')).length;
    if (reviews !== 0) failures.push(`TDD workflow: ${label} still ran ${reviews} review pass(es)`);
  }
  for (const [label, extraArgs] of [
    ['a negative budget', { maxReviewPasses: -1 }],
    ['a fractional budget', { maxReviewPasses: 1.5 }],
    ['a budget passed as a string', { maxReviewPasses: '6' }],
    ['NaN', { maxRefutedOnlyPasses: NaN }],
  ]) {
    const error = await renderCycle({ ...approving, extraArgs }).then(() => null, (e) => e);
    if (!error) failures.push(`TDD workflow: ${label} was accepted — a budget that is not a non-negative integer must throw before any delegate runs`);
  }
}

// A delegate that returns nothing is a DEAD delegate, and eight phases used to answer that with a
// bare throw. A throw loses the record: the workflow tool surfaces the message and the run's whole
// state — the architect verdict already paid for, RED's tests already on disk, the review passes
// already made — is gone, so the re-run starts from the top and RED re-authors a test that now
// passes and cannot fail its own gate. Each site must RETURN a structured halt that carries the
// state in scope, and must never read as an approval.
{
  const approving = {
    reviewScript: () => ({ verdict: 'APPROVED', findings: [], skippedCategories: [] }),
    verifyFor: allVerdicts(false),
  };
  for (const [dieLabel, halted, carries] of [
    // GREEN is the case named in the brief and the worst one to lose: RED's tests are on disk and
    // the implementer may have edited files before dying, so the record has to say resume at GREEN.
    ['green', 'green-delegate-died', ['gate', 'red']],
    ['review:pass-1', 'review-delegate-died', ['gate', 'red', 'green']],
  ]) {
    const outcome = await renderCycle({ ...approving, dieAt: [dieLabel] }).then((r) => r, (e) => e);
    if (outcome instanceof Error) {
      failures.push(`TDD workflow: a dead ${dieLabel} delegate threw ("${outcome.message}") instead of returning a halt — the throw discards the cycle record the re-run needs`);
      continue;
    }
    const { result } = outcome;
    if (result.halted !== halted) {
      failures.push(`TDD workflow: a dead ${dieLabel} delegate halted as ${result.halted}, expected ${halted}`);
    }
    if (result.approved) failures.push(`TDD workflow: a dead ${dieLabel} delegate returned approved — a delegate that produced no record is not an approval`);
    if (!result.detail || !result.delegate) {
      failures.push(`TDD workflow: the ${halted} record carries no detail/delegate block, so nothing says where a re-run resumes`);
    }
    for (const key of carries) {
      if (!result[key]) failures.push(`TDD workflow: the ${halted} record dropped ${key} — the phases already paid for must survive the halt`);
    }
  }
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

// cycle-to-commit.js had no behavioural coverage at all — only tdd-cycle.js got the renderCycle
// treatment — while it owns the accounting that decides what an autonomous run still has to close.
// Two defects, opposite in direction and both live:
//   · it re-opened findings the cycle had already settled, including one the Finding Verifier had
//     REFUTED. CLASS_RULE then orders a mechanical sweep for every instance of a defect class
//     proven not to exist, rejectable "only with a refuting command output" — so the closer must
//     re-buy a refutation already paid for, or invent a fix for a defect that was never there.
//   · it read `securityReview` (singular), which tdd-cycle overwrites per pass, so an entire
//     security pass 1 vanished: its findings never reached `open`, could not trigger
//     `close-rounds-exhausted`, and were absent from the returned record — under a workflow whose
//     whole contract is "nothing ships open, however small".
//
// `import.meta.url` is a SyntaxError inside `new Function()`, so it is substituted — and the
// substitution is asserted, because a silent no-op there would render a script that no longer
// matches the file and prove nothing about it.
async function renderCycleToCommit({ child, closeScript, verifyScript, gate }) {
  const rel = '.claude/workflows/cycle-to-commit.js';
  const source = await readFile(path.join(repoRoot, rel), 'utf8');
  const stubbed = source.replace(/import\.meta\.url/g, JSON.stringify(`file://${path.join(repoRoot, rel)}`));
  if (stubbed === source) failures.push(`${rel}: no import.meta.url to substitute — the render stub is out of step with the file`);
  const calls = [];
  let round = 0;
  const stubs = {
    args: { project: 'p', projectPath: 'projects/personal/p', plan: '001', cycle: '9.9', greenAgent: 'Python Expert' },
    workflow: async (_target, childArgs) => { calls.push({ label: 'workflow:tdd-cycle', childArgs }); return child; },
    agent: async (prompt, opts = {}) => {
      const label = opts.label || '(unlabelled)';
      calls.push({ label, prompt });
      if (label.startsWith('close:')) return closeScript(round += 1);
      if (label.startsWith('verify:')) return verifyScript(round);
      if (label === 'commit-gate') return gate;
      return {};
    },
    parallel: (thunks) => Promise.all(thunks.map((thunk) => thunk())),
    phase: () => {},
    log: () => {},
  };
  const render = new Function(
    ...Object.keys(stubs),
    `return (async () => {\n${stubbed.replace(/^export const meta/m, 'const meta')}\n})()`,
  );
  return { result: await render(...Object.values(stubs)), calls };
}

{
  const nit = (finding, file) => ({ tag: 'NIT', finding, file });
  const child = {
    approved: true,
    reviewLog: [
      // Pass 1: one BLOCKER the verifier refuted, and one NIT that is genuinely open.
      { pass: 1, findings: [{ tag: 'BLOCKER', finding: 'unbounded loop', file: 'a.py' }, nit('name reads oddly', 'a.py')] },
      // Pass 2: a BLOCKER that WAS refactored, so the cycle settled it.
      { pass: 2, findings: [{ tag: 'BLOCKER', finding: 'missing guard', file: 'b.py' }] },
    ],
    // tdd-cycle builds the claim as `[tag] finding` and stamps the pass; the wrapper rebuilds
    // exactly that string, so the pass stamp is what stops a refutation leaking across passes.
    hallucinationsRejected: [{ pass: 1, claim: '[BLOCKER] unbounded loop', evidence: 'ran git diff --stat' }],
    refactors: [{ pass: 2, resolutions: [{ finding: 'missing guard', resolution: 'added' }] }],
    securityReviews: [
      { pass: 3, findings: [nit('error message leaks the field name', 'sec.py')] },
      { pass: 4, findings: [] },
    ],
    // The singular is the LAST pass, which is precisely why reading it lost pass 3.
    securityReview: { pass: 4, findings: [] },
  };
  const { result, calls } = await renderCycleToCommit({
    child,
    closeScript: (r) => ({ gateResult: 'Passed: 1 / Failed: 0', classes: [{ className: 'c', enumerationCommand: 'grep -rn x', instancesFound: 1, instancesFixed: 1 }] }),
    verifyScript: () => ({ dry: true, openFindings: [], gateResult: 'Passed: 1 / Failed: 0' }),
    gate: { worktreeConfirmed: '/tmp/wt', verdict: 'APPROVED', commitReady: true, findings: [], gateResult: 'Passed: 1 / Failed: 0', filesInDiff: ['a.py'] },
  });
  const closer = calls.find((c) => c.label.startsWith('close:'));
  if (!closer) {
    failures.push('cycle-to-commit: no close round ran — the probe left nothing open, so it asserts nothing');
  } else {
    if (closer.prompt.includes('unbounded loop')) {
      failures.push('cycle-to-commit: handed the closer a finding the Finding Verifier had REFUTED — CLASS_RULE then demands a mechanical sweep for a defect class proven not to exist');
    }
    if (closer.prompt.includes('missing guard')) {
      failures.push('cycle-to-commit: handed the closer a blocking finding that its pass already REFACTORED — a later review pass re-raises anything still real');
    }
    if (!closer.prompt.includes('error message leaks the field name')) {
      failures.push('cycle-to-commit: a NIT from security pass 1 never reached the closer — reading the singular securityReview drops every pass but the last, under a workflow whose contract is "nothing ships open"');
    }
    if (!closer.prompt.includes('name reads oddly')) {
      failures.push('cycle-to-commit: a genuinely open NIT never reached the closer');
    }
  }
  if (!result.findingsSettled || result.findingsSettled.refuted !== 1 || result.findingsSettled.resolved !== 1) {
    failures.push(`cycle-to-commit: findingsSettled is ${JSON.stringify(result.findingsSettled)}, expected { refuted: 1, resolved: 1 } — the accounting has to be readable from the record, not only inferable`);
  }
  if (!Array.isArray(result.securityReviews) || result.securityReviews.length !== 2) {
    failures.push(`cycle-to-commit: the record returned ${JSON.stringify(result.securityReviews)} for securityReviews — the cycle note's roster needs every security pass, not the last`);
  }
  if (!result.commitReady) failures.push(`cycle-to-commit: a fully closed cycle was not commit-ready (halted: ${result.halted})`);

  // The other direction, and it is what stops the subtraction from being "settle everything": a
  // finding that is still open must still stop the run. The same security NIT, with the closer
  // unable to clear it, has to exhaust the rounds rather than fall through to the commit gate.
  const stubborn = await renderCycleToCommit({
    child,
    closeScript: () => ({ gateResult: 'Passed: 1 / Failed: 0', classes: [] }),
    verifyScript: () => ({ dry: false, openFindings: [nit('error message leaks the field name', 'sec.py')], gateResult: 'Passed: 1 / Failed: 0' }),
    gate: { worktreeConfirmed: '/tmp/wt', verdict: 'APPROVED', commitReady: true, findings: [], gateResult: 'Passed: 1 / Failed: 0', filesInDiff: [] },
  });
  if (stubborn.result.halted !== 'close-rounds-exhausted') {
    failures.push(`cycle-to-commit: an unclosed finding halted as ${stubborn.result.halted}, expected close-rounds-exhausted — falling through downgrades a convergence failure into one reviewer's judgement call`);
  }
  if (stubborn.calls.some((c) => c.label === 'commit-gate')) {
    failures.push('cycle-to-commit: the commit gate ran with a finding still open');
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

// Reviewer attribution in the cycle note — the record that says WHO approved a cycle, and the only
// mechanical trace of cycle-orchestration.md §Reviewer separation. Two holes, both live:
//   · `reviewer-agent-id` was `minLength: 1` plus a "self-review" keyword filter, so
//     "wf:this-session/self review by the orchestrator" was rejected while
//     "reviewed by me, looked fine" validated clean. A free-prose id names no verifiable agent.
//   · a note whose REVIEW pass produced no findings named NOBODY at all: reviewer-agent-id lived
//     only inside reviewer-findings[], so the clean-APPROVED case — exactly where an accidental
//     self-review hides — left a note indistinguishable from a compliant one.
// Both directions are asserted, and the legacy-tolerance case is asserted just as hard as the
// rejections: cycle notes are historical execution records that are never rewritten, and 126 of the
// 130 on record carry prose ids. A grammar that "fixed" those would falsify the corpus wholesale,
// so tolerance on a roster-less note is a REQUIREMENT here, not an oversight to tighten later.
if (Ajv) {
  const noteValidator = path.join(repoRoot, 'tools/docs-gen/scripts/validate-cycle-note.mjs');
  const notesDir = await mkdtemp(path.join(os.tmpdir(), 'agent-config-notes-'));
  try {
    // The filename carries the cycle id (the validator cross-checks the two), so each case gets
    // its own directory rather than its own cycle number.
    const writeNote = async (name, body) => {
      const dir = path.join(notesDir, name);
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, '9.9.yaml');
      await writeFile(file, [
        'project: fixture', 'cycle: "9.9"',
        'outcome:', '  summary: a cycle', '  gate: "Passed: 1 / Failed: 0"',
        ...body,
      ].join('\n'));
      return file;
    };
    const CANONICAL = 'wf:tdd-cycle.fixture.p001.c9.9/review-pass-1';
    const roster = (id) => ['review-passes:', `  - pass: 1`, `    reviewer-agent-id: "${id}"`, '    verdict: APPROVED'];
    const finding = (id) => [
      'reviewer-findings:', '  - tag: NIT', '    finding: a nit', '    resolution: fixed',
      '    pass: 1', `    reviewer-agent-id: "${id}"`,
    ];

    for (const [label, name, body, expect, wants] of [
      // The shape tdd-cycle.js emits, roster and findings both canonical.
      ['a conforming workflow-issued roster', 'ok-roster',
        [...finding(CANONICAL), ...roster(CANONICAL)], 0, []],
      // The manual path: a bare Agent-tool id. Without this branch the roster is unfillable off
      // the workflow, so it would stay unused — the defect recurring, not fixed.
      ['a bare Agent-tool id', 'ok-agent-id',
        ['reviewer-findings: []', ...roster('a3c94389c274c9715')], 0, []],
      ['a hand-composed prose id in review-passes[]', 'prose-roster',
        ['reviewer-findings: []', ...roster('Code Reviewer (fresh, pass 1) — APPROVED')], 1,
        ['/review-passes/0/reviewer-agent-id', 'expected a canonical reviewer id']],
      // Presence of the roster marks a note NEW-style, and escalates reviewer-findings[] to the
      // same grammar — otherwise a new note keeps writing prose where the constraint does not bind.
      ['prose in reviewer-findings[] on a roster-bearing note', 'prose-findings',
        [...finding('cr051@session-f3a1ebde'), ...roster(CANONICAL)], 1,
        ['/reviewer-findings/0/reviewer-agent-id']],
      // The legacy corpus. A roster-less note keeps its prose ids; 126 notes depend on it.
      ['a legacy note with a prose id and no roster', 'legacy-prose',
        finding('Code Reviewer a03c8edf612e5dd26 (APPROVED, pass 3)'), 0, []],
      // …but the residual self-review floor still binds on that surface.
      ['a self-review id on a legacy note', 'legacy-self-review',
        finding('wf:this-session/self review by the orchestrator'), 1, ['reviewer-agent-id']],
      // The clean-APPROVED hole: no findings, no roster, so the note names nobody.
      ['a note that names no reviewer', 'no-attribution', ['reviewer-findings: []'], 1,
        ['names no reviewer']],
      // An empty roster names nobody either — a check keyed on the key's presence would pass it.
      ['a note whose roster is empty', 'empty-roster',
        ['reviewer-findings: []', 'review-passes: []'], 1, ['names no reviewer']],
    ]) {
      const file = await writeNote(name, body);
      const result = run('node', [noteValidator, file], { cwd: path.join(repoRoot, 'tools/docs-gen') });
      const said = `${result.stdout}${result.stderr}`;
      if (result.status !== expect) {
        failures.push(`cycle-note validator: ${label} exited ${result.status}, expected ${expect}\n${said}`);
      }
      for (const want of wants) {
        if (!said.includes(want)) failures.push(`cycle-note validator: ${label} did not report ${JSON.stringify(want)}\n${said}`);
      }
    }

    // The counterweight that keeps all of the above honest: every note the repo has ever filed
    // must still validate. A grammar strict enough to reject prose is one keystroke away from
    // rejecting the corpus it has to grandfather. Skipped when `projects/` is absent (root-only
    // clone or worktree) — the validator itself reports "nothing to validate" and exits 0 there,
    // so the assertion would be vacuous rather than wrong.
    if (await access(path.join(repoRoot, 'projects')).then(() => true).catch(() => false)) {
      const corpus = run('node', [noteValidator], { cwd: path.join(repoRoot, 'tools/docs-gen') });
      const said = `${corpus.stdout}${corpus.stderr}`;
      if (corpus.status !== 0) {
        const shown = said.split('\n').filter((line) => line.startsWith('✗') || line.startsWith('    ')).slice(0, 12).join('\n');
        failures.push(`cycle-note validator: the historical corpus no longer validates (exit ${corpus.status}) — a note on record is an execution record, not a draft to bring up to the current schema\n${shown}`);
      }
      const counted = said.match(/all (\d+) cycle-note files valid/);
      if (counted && Number(counted[1]) < 100) {
        failures.push(`cycle-note validator: only ${counted[1]} notes were walked — the corpus assertion is not covering what it claims`);
      }
    }
  } finally {
    await rm(notesDir, { recursive: true, force: true });
  }
}

if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log('agent config behavior tests passed');
