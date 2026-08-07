#!/usr/bin/env node

import { access, readdir, readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { READ_ONLY_ROLES, FORBIDDEN_TOOLS, MINIMUM_TIER, TIER_RANK } from './read-only-roles.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const errors = [];

function frontmatter(source, label) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    errors.push(`${label}: missing YAML frontmatter`);
    return '';
  }
  return match[1];
}

function fieldLines(block, names) {
  return block
    .split('\n')
    .filter((line) => names.some((name) => line.startsWith(`${name}:`)));
}

function parseRole(source, label) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    errors.push(`${label}: missing YAML frontmatter or body`);
    return null;
  }
  const name = match[1].match(/^name:\s*(.+)$/m)?.[1];
  const description = match[1].match(/^description:\s*(.+)$/m)?.[1];
  if (!name || !description) {
    errors.push(`${label}: missing name or description`);
    return null;
  }
  return { name, description, body: match[2].trim() };
}

function codexName(filename) {
  return filename.replace(/\.md$/, '').replaceAll('-', '_').replaceAll('.', 'dot');
}

function expectedCodexRole(filename, role) {
  const instructions = `Canonical role: .agents/roles/${filename}\nResolve relative paths and Markdown links from that canonical file.\n\n${role.body}`;
  const readOnly = READ_ONLY_ROLES.includes(filename);
  return [
    `name = ${JSON.stringify(codexName(filename))}`,
    `description = ${JSON.stringify(role.description)}`,
    ...(readOnly ? ['sandbox_mode = "read-only"'] : []),
    `developer_instructions = ${JSON.stringify(instructions)}`,
    '',
  ].join('\n');
}

async function markdownFiles(dir) {
  return (await readdir(dir)).filter((name) => name.endsWith('.md')).sort();
}

async function validateRoles() {
  const dir = path.join(repoRoot, '.agents/roles');
  const adapterDir = path.join(repoRoot, '.claude/agents');
  const codexAdapterDir = path.join(repoRoot, '.codex/agents');
  const canonicalFiles = await markdownFiles(dir);
  const adapterFiles = await markdownFiles(adapterDir);
  const codexAdapterFiles = (await readdir(codexAdapterDir)).filter((name) => name.endsWith('.toml')).sort();
  const expectedCodexFiles = canonicalFiles.map((name) => name.replace(/\.md$/, '.toml'));
  if (canonicalFiles.join('\n') !== adapterFiles.join('\n')) errors.push('role adapter set differs from canonical role set');
  if (expectedCodexFiles.join('\n') !== codexAdapterFiles.join('\n')) errors.push('Codex role adapter set differs from canonical role set');
  for (const filename of canonicalFiles) {
    const source = await readFile(path.join(dir, filename), 'utf8');
    const block = frontmatter(source, `.agents/roles/${filename}`);
    const keys = block.split('\n').filter((line) => /^[a-z][a-z-]*:/.test(line)).map((line) => line.split(':', 1)[0]);
    for (const required of ['name', 'description']) {
      if (!keys.includes(required)) errors.push(`.agents/roles/${filename}: missing ${required}`);
    }
    for (const key of keys) {
      if (!['name', 'description'].includes(key)) errors.push(`.agents/roles/${filename}: provider field ${key}`);
    }
    const adapter = await readFile(path.join(adapterDir, filename), 'utf8').catch(() => '');
    if (!adapter) continue;
    const adapterBlock = frontmatter(adapter, `.claude/agents/${filename}`);
    if (fieldLines(block, ['name', 'description']).join('\n') !== fieldLines(adapterBlock, ['name', 'description']).join('\n')) {
      errors.push(`.claude/agents/${filename}: routing frontmatter is stale`);
    }
    if (!adapter.includes(`Read \`.agents/roles/${filename}\` in full`)) errors.push(`.claude/agents/${filename}: wrong canonical target`);

    // `tools:` is preserved from disk by sync-claude-adapters.mjs, never derived, so a new
    // role ships with NO allowlist and nothing notices. For the review family that silently
    // grants write access to agents whose whole contract is that they cannot write — the
    // Code Reviewer's "your toolset carries no edit access, so the review stays a review".
    // Only that family is checked, and per-role: the others' allowlists are a runtime choice
    // with no canonical source to check them against, and the three review roles differ
    // (security-reviewer keeps Write to file its threat model). See read-only-roles.mjs.
    const forbidden = FORBIDDEN_TOOLS[filename];
    if (forbidden) {
      const toolsLine = fieldLines(adapterBlock, ['tools'])[0];
      if (!toolsLine) {
        errors.push(`.claude/agents/${filename}: review-family role has no tools allowlist`);
      } else {
        const granted = toolsLine.replace(/^tools:\s*/, '').split(',').map((tool) => tool.trim());
        const violations = granted.filter((tool) => forbidden.includes(tool));
        if (violations.length) {
          errors.push(`.claude/agents/${filename}: must not grant ${violations.join(', ')}`);
        }
      }
    }

    // `model:` is preserved from disk by sync-claude-adapters.mjs the same way `tools:` is,
    // and was validated by nothing: setting code-reviewer.md to `model: haiku` left BOTH
    // validate-agent-config.mjs and test-agent-config.mjs byte-identical in output and exit
    // code. Per-role floors, not a flat `top`, for the same reason FORBIDDEN_TOOLS is
    // per-role — finding-verifier legitimately runs at `mid` (tdd-cycle.js dispatches its
    // refutation pass at MODELS.mid), so a flat floor would report a correct adapter as a
    // violation. Rank-compare rather than a denylist so an absent or retired token ranks 0
    // and fails every floor without a list that must track tiers that no longer exist.
    const floor = MINIMUM_TIER[filename];
    if (floor) {
      const modelLine = fieldLines(adapterBlock, ['model'])[0];
      const model = modelLine ? modelLine.replace(/^model:\s*/, '').trim() : null;
      if (!model) {
        errors.push(`.claude/agents/${filename}: review-family role declares no model`);
      } else if ((TIER_RANK[model] ?? 0) < TIER_RANK[floor]) {
        errors.push(`.claude/agents/${filename}: model ${model} is below the ${floor} floor`);
      }
    }

    const role = parseRole(source, `.agents/roles/${filename}`);
    if (!role) continue;
    const codexFilename = filename.replace(/\.md$/, '.toml');
    const codexAdapter = await readFile(path.join(codexAdapterDir, codexFilename), 'utf8').catch(() => '');
    if (!codexAdapter) {
      errors.push(`.codex/agents/${codexFilename}: missing adapter`);
    } else if (codexAdapter !== expectedCodexRole(filename, role)) {
      errors.push(`.codex/agents/${codexFilename}: generated adapter is stale`);
    }
  }
}

async function validateSkills() {
  const dir = path.join(repoRoot, '.agents/skills');
  const adapterDir = path.join(repoRoot, '.claude/skills');
  const canonicalDirs = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const adapterDirs = (await readdir(adapterDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  if (canonicalDirs.join('\n') !== adapterDirs.join('\n')) errors.push('skill adapter set differs from canonical skill set');
  for (const dirname of canonicalDirs) {
    const source = await readFile(path.join(dir, dirname, 'SKILL.md'), 'utf8').catch(() => null);
    if (!source) continue;
    const block = frontmatter(source, `.agents/skills/${dirname}/SKILL.md`);
    if (!new RegExp(`^name: ${dirname}$`, 'm').test(block)) errors.push(`.agents/skills/${dirname}: name must match directory`);
    if (!/^description:/m.test(block)) errors.push(`.agents/skills/${dirname}: missing description`);
    const adapter = await readFile(path.join(adapterDir, dirname, 'SKILL.md'), 'utf8').catch(() => '');
    if (!adapter) {
      errors.push(`.claude/skills/${dirname}: missing adapter`);
      continue;
    }
    if (frontmatter(adapter, `.claude/skills/${dirname}/SKILL.md`) !== block) errors.push(`.claude/skills/${dirname}: frontmatter is stale`);
    if (!adapter.includes(`Read \`.agents/skills/${dirname}/SKILL.md\` in full`)) errors.push(`.claude/skills/${dirname}: wrong canonical target`);
  }
}

// Each Claude hook: the portable policy it must delegate to, and the settings.json event +
// matcher that must actually invoke it. The second half is the point — checking only that a
// script names its delegate proves the script is correct, not that anything RUNS it. Before
// this, the whole `hooks` block could be deleted from settings.json and the config still
// validated clean.
const CLAUDE_HOOKS = {
  'block-commit-flags.sh': { target: '.agents/scripts/check-commit-command.sh', event: 'PreToolUse', matcher: 'Bash' },
  'block-generated-writes.sh': { target: '.agents/scripts/check-generated-command.py', event: 'PreToolUse', matcher: 'Bash' },
  'block-generated-html.sh': { target: '.agents/scripts/check-generated-path.sh', event: 'PreToolUse', matcher: 'Edit|Write|NotebookEdit' },
  'validate-docs-yaml.sh': { target: '.agents/scripts/validate-docs-yaml.sh', event: 'PostToolUse', matcher: 'Edit|Write' },
};

async function validateClaudeSettings() {
  const file = '.claude/settings.json';
  let settings;
  try {
    settings = JSON.parse(await readFile(path.join(repoRoot, file), 'utf8'));
  } catch (error) {
    errors.push(`${file}: invalid JSON (${error.message})`);
    return;
  }
  for (const [filename, { event, matcher }] of Object.entries(CLAUDE_HOOKS)) {
    const entries = settings?.hooks?.[event];
    if (!Array.isArray(entries)) {
      errors.push(`${file}: missing ${event} hooks (${filename} is unwired)`);
      continue;
    }
    const group = entries.find((e) => e && e.matcher === matcher);
    if (!group) {
      errors.push(`${file}: no ${event} entry with matcher "${matcher}" (${filename} is unwired)`);
      continue;
    }
    const wired = (group.hooks || []).some((h) => typeof h?.command === 'string' && h.command.includes(filename));
    if (!wired) errors.push(`${file}: ${event}/"${matcher}" does not invoke ${filename}`);
  }
}

async function validateClaudeRuntimeAdapters() {
  for (const [filename, { target }] of Object.entries(CLAUDE_HOOKS)) {
    const source = await readFile(path.join(repoRoot, '.claude/hooks', filename), 'utf8').catch(() => '');
    if (!source) { errors.push(`.claude/hooks/${filename}: missing`); continue; }
    if (!source.includes(target)) errors.push(`.claude/hooks/${filename}: does not delegate to ${target}`);
  }
  for (const name of ['tdd-cycle', 'plan-batch', 'cycle-to-commit']) {
    const adapter = await readFile(path.join(repoRoot, `.claude/workflows/${name}.js`), 'utf8');
    if (!adapter.includes('.agents/rules')) errors.push(`.claude/workflows/${name}.js: does not use canonical rules`);
    const spec = await readFile(path.join(repoRoot, `.agents/workflows/${name}.md`), 'utf8');
    if (!spec.includes(`.claude/workflows/${name}.js`)) errors.push(`.agents/workflows/${name}.md: missing adapter pointer`);
  }
}

async function validateCodexRuntimeAdapters() {
  const config = await readFile(path.join(repoRoot, '.codex/config.toml'), 'utf8');
  for (const expected of ['[agents]', 'max_threads = 4', 'max_depth = 1']) {
    if (!config.includes(expected)) errors.push(`.codex/config.toml: missing ${expected}`);
  }

  let hooks;
  try {
    hooks = JSON.parse(await readFile(path.join(repoRoot, '.codex/hooks.json'), 'utf8'));
  } catch (error) {
    errors.push(`.codex/hooks.json: invalid JSON (${error.message})`);
    return;
  }
  const serialized = JSON.stringify(hooks);
  for (const target of ['.codex/hooks/block-commit-flags.sh', '.codex/hooks/dispatch-file-policy.py']) {
    if (!serialized.includes(target)) errors.push(`.codex/hooks.json: missing ${target}`);
  }
  for (const phase of ['PreToolUse', 'PostToolUse']) {
    if (!Array.isArray(hooks?.hooks?.[phase]) || hooks.hooks[phase].length === 0) {
      errors.push(`.codex/hooks.json: missing ${phase} hooks`);
    }
  }

  const commitHook = await readFile(path.join(repoRoot, '.codex/hooks/block-commit-flags.sh'), 'utf8');
  if (!commitHook.includes('.agents/scripts/check-commit-command.sh')) {
    errors.push('.codex/hooks/block-commit-flags.sh: does not delegate to portable policy');
  }
  const pathHook = await readFile(path.join(repoRoot, '.codex/hooks/dispatch-file-policy.py'), 'utf8');
  for (const target of ['.agents/scripts/check-generated-path.sh', '.agents/scripts/validate-docs-yaml.sh']) {
    if (!pathHook.includes(target)) errors.push(`.codex/hooks/dispatch-file-policy.py: missing ${target}`);
  }
}

// Substring-grepping the hook wiring proves only that a path is spelled somewhere. It would
// not have caught either real break found in review: a launcher that resolved the repo root
// via `git rev-parse --show-toplevel` (which returns the NESTED project repo, so the hook was
// never found at all), or a policy that denied every Bash call it could not tokenize. Both
// are invisible to a grep and obvious to a single execution — so execute it.
function runHook(hookPath, toolInput, cwd) {
  return new Promise((resolve) => {
    const child = execFile(hookPath, { cwd, timeout: 20000 }, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stderr: stderr ?? '' });
    });
    child.stdin.end(JSON.stringify({ tool_name: 'Bash', tool_input: toolInput }));
  });
}

// DERIVED, never hand-listed. This used to be four literals, and both `block-generated-writes.sh`
// adapters were missing from it — so the whole generated-output write policy shipped with neither
// validator executing it even once, and #20 (`echo x >projects/…/docs/html/index.html` accepted at
// exit 0, the hand-edit then silently gone on the next `npm run build`) was invisible here. A
// hand-maintained list is exactly the failure that repeats: the fifth hook would have been missed
// the same way, so nothing about this may require remembering.
//
// Three sources, unioned, because each catches what the others cannot:
//   · CLAUDE_HOOKS keys — the config table above. Authoritative for the Claude side: a hook named
//     there but absent from disk is itself the finding, which a disk walk would silently skip.
//   · .codex/hooks.json — the Codex side has no table in this file; the wiring IS the table.
//   · both hook directories on disk — covers an adapter added to disk before it is wired, from
//     whichever side it lands.
// `.sh` only: dispatch-file-policy.py takes an argv subcommand and a different payload shape, and
// test-agent-config.mjs drives it with both.
async function adapterHookPaths() {
  const paths = new Set(Object.keys(CLAUDE_HOOKS).map((name) => `.claude/hooks/${name}`));
  const wiring = await readFile(path.join(repoRoot, '.codex/hooks.json'), 'utf8').catch(() => '');
  for (const hit of wiring.match(/\.codex\/hooks\/[\w.-]+\.sh/g) || []) paths.add(hit);
  for (const dir of ['.claude/hooks', '.codex/hooks']) {
    for (const name of await readdir(path.join(repoRoot, dir)).catch(() => [])) {
      if (name.endsWith('.sh')) paths.add(`${dir}/${name}`);
    }
  }
  return [...paths].sort();
}

// Every adapter hook must at minimum LOCATE its portable script and exit cleanly on a
// benign payload. A hook that cannot find .agents/ exits non-zero (or silently no-ops),
// and that is invisible to the substring greps above.
async function validateAllHooksResolve(cwd) {
  const benign = { command: 'echo hello', file_path: path.join(repoRoot, 'README-nonexistent.txt') };
  const hooks = await adapterHookPaths();
  if (hooks.length < 4) errors.push(`hook coverage: derived only ${hooks.length} adapter hooks — the derivation is broken, not the config`);
  for (const hook of hooks) {
    const { code, stderr } = await runHook(path.join(repoRoot, hook), benign, cwd);
    if (code !== 0) {
      errors.push(`${hook}: benign payload should exit 0, got ${code} (${stderr.trim().split('\n')[0]})`);
    }
    if (/No such file or directory|command not found/.test(stderr)) {
      errors.push(`${hook}: cannot resolve its portable script from cwd ${cwd} (${stderr.trim().split('\n')[0]})`);
    }
  }
}

// First `projects/<group>/<name>/` that is its own git repository, in a stable order. Returns
// null in a root-only clone or a git worktree, where `projects/` is absent entirely.
async function firstNestedRepo() {
  const projects = path.join(repoRoot, 'projects');
  const dirs = async (parent) => (await readdir(parent, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const group of await dirs(projects)) {
    for (const project of await dirs(path.join(projects, group))) {
      const dir = path.join(projects, group, project);
      if (await access(path.join(dir, '.git')).then(() => true).catch(() => false)) return dir;
    }
  }
  return null;
}

async function validateHookBehaviour() {
  const apostrophe = String.fromCharCode(39);
  const cases = [
    { name: 'short subject allowed', command: 'git commit -m "feat: short"', expect: 0 },
    { name: 'long subject blocked', command: `git commit -m "feat: ${'x'.repeat(51)}"`, expect: 2 },
    { name: '--amend blocked', command: 'git commit --amend -m "x"', expect: 2 },
    { name: '--no-verify blocked', command: 'git commit --no-verify -m "x"', expect: 2 },
    // The blocker: a heredoc body with an odd number of apostrophes must NOT be denied.
    {
      name: 'heredoc prose allowed',
      command: `cat > /dev/null <<${apostrophe}EOF${apostrophe}\nit doesn${apostrophe}t matter\nEOF`,
      expect: 0,
    },
    { name: 'non-git command allowed', command: 'echo hello', expect: 0 },
  ];

  // Run from inside a nested project repo when one exists — that is exactly where a
  // root-resolution bug hides, because `.agents/` lives only at the monorepo root while
  // `git rev-parse --show-toplevel` down there answers with the NESTED repo.
  //
  // Found on disk rather than named. This used to hardcode projects/personal/u60-monitor; when
  // that project was retired the `access` fallback quietly moved every case below back to
  // repoRoot — the one cwd this check exists NOT to be run from — and the suite stayed green
  // while covering nothing. A `.git` entry is the discriminator because it is precisely what
  // makes rev-parse answer wrong.
  const cwd = (await firstNestedRepo()) || repoRoot;

  await validateAllHooksResolve(cwd);

  // Resolution is not behaviour. validateAllHooksResolve() asserts exit 0 on a benign payload,
  // which a policy that blocks NOTHING also satisfies — a mutation making `offending()` return
  // None unconditionally leaves it, and every substring grep above, perfectly clean. So each
  // adapter gets one case in each direction: the exact write that #20 walked through, and the
  // ordinary redirect that a blunter fix would break.
  //
  // Relative paths are deliberate: check-generated-command.py resolves them against the REPO
  // root rather than $PWD, and these run from inside a nested project repo (see the cwd note
  // above), so a policy that quietly switched to cwd-relative resolution fails here.
  const generatedCases = [
    // #20 itself. No space after the operator, so `>docs/html/index.html` lexed as ONE word,
    // matched no redirect pattern, and the write was allowed; `npm run build` then erased the
    // hand-edit with no trace of either event.
    { name: 'spaceless redirect into generated output', command: 'echo x >docs/html/index.html', expect: 2 },
    { name: 'spaced redirect into generated output', command: 'echo x > docs/html/index.html', expect: 2 },
    // A policy that blocks `npm test > out.log 2>&1` is one an agent learns to route around, so
    // the harmless direction is pinned as hard as the blocked one.
    { name: 'redirect outside the generated tree allowed', command: 'npm test >/tmp/out.log 2>&1', expect: 0 },
    { name: 'reading generated output allowed', command: 'cat docs/html/index.html', expect: 0 },
  ];

  for (const [hooks, hookCases, field] of [
    [['.claude/hooks/block-commit-flags.sh', '.codex/hooks/block-commit-flags.sh'], cases, 'command'],
    [['.claude/hooks/block-generated-writes.sh', '.codex/hooks/block-generated-writes.sh'], generatedCases, 'command'],
  ]) {
    for (const hook of hooks) {
      const hookPath = path.join(repoRoot, hook);
      for (const testCase of hookCases) {
        const { code, stderr } = await runHook(hookPath, { [field]: testCase.command }, cwd);
        if (code !== testCase.expect) {
          errors.push(
            `${hook}: ${testCase.name} — expected exit ${testCase.expect}, got ${code}` +
            (stderr.trim() ? ` (${stderr.trim().split('\n')[0]})` : ''),
          );
        }
      }
    }
  }
}

async function validateLinks() {
  const roots = [path.join(repoRoot, 'AGENTS.md'), path.join(repoRoot, '.agents')];
  const files = [];
  async function collect(entry) {
    const info = await stat(entry);
    if (info.isDirectory()) {
      for (const child of await readdir(entry)) await collect(path.join(entry, child));
    } else if (entry.endsWith('.md')) files.push(entry);
  }
  for (const root of roots) await collect(root);

  // GitHub's heading-slug rules, which is what these #anchors are written against.
  // Each space becomes its own hyphen — NOT collapsed. Removing an em-dash from
  // "Deferral policy — fix now" leaves two adjacent spaces, and the real anchor is
  // `deferral-policy--fix-now`; collapsing runs would look for a single hyphen and
  // report every correct link in the repo as broken.
  const slug = (heading) => heading.trim().toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s/g, '-');
  const anchorCache = new Map();
  async function anchorsOf(file) {
    if (!anchorCache.has(file)) {
      const text = await readFile(file, 'utf8').catch(() => '');
      const found = new Set();
      for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) found.add(slug(m[1]));
      anchorCache.set(file, found);
    }
    return anchorCache.get(file);
  }

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const raw = match[1];
      if (/^(https?:|mailto:|#)/.test(raw) || raw.includes('<')) continue;
      const [target, fragment] = raw.split('#');
      if (!target) continue;
      const resolved = path.resolve(path.dirname(file), target);
      const ok = await access(resolved).then(() => true).catch(() => {
        errors.push(`${path.relative(repoRoot, file)}: missing link target ${raw}`);
        return false;
      });
      // Check the #fragment too. Previously it was split off and discarded, so a renamed
      // heading silently broke every rule that pointed at it — and these rules lean on
      // section links heavily.
      if (ok && fragment && resolved.endsWith('.md')) {
        const anchors = await anchorsOf(resolved);
        if (anchors.size && !anchors.has(fragment.toLowerCase())) {
          errors.push(`${path.relative(repoRoot, file)}: link ${raw} points at no heading in ${path.relative(repoRoot, resolved)}`);
        }
      }
    }
  }
}

// Canonical agent config lives in `.agents/`; `.claude/` and `.codex/` are thin adapters (root
// AGENTS.md §Layout). Some canonical directories have no adapter counterpart at all: the rules
// moved from `.claude/rules/` to `.agents/rules/` in root commit 88949bb, and for six weeks
// after that move 53 pointer lines across 11 project guides and 347 across 25 plan YAMLs still
// sent agents to the old path. Nothing noticed, because a pointer in a guide is prose — it is
// only ever followed by a subagent mid-cycle, which reads nothing and carries on. kobu-bot (paid
// client) routed the security-tier gate for its HMAC-verify and admin-auth cycles into that dead
// directory. validateLinks() below never saw any of it: most are backticked paths inside session
// prompts, not Markdown links.
//
// The dead set is derived from disk rather than hardcoded, so the next canonical directory to
// move is covered the day it moves. That derivation is also what keeps the check from
// over-reaching: an adapter path is flagged only when `.agents/` has that name and the adapter
// does not. That leaves `.claude/settings.json`, `.claude/workflows/` and `.claude/skills/` alone
// because those still exist, and leaves `.claude/worktrees/` alone in the other direction —
// adapter-only, with no canonical counterpart it could have moved away from.
async function deadAdapterDirs() {
  const subdirs = async (rel) => new Set(
    (await readdir(path.join(repoRoot, rel), { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
  const canonical = await subdirs('.agents');
  const dead = [];
  for (const adapter of ['.claude', '.codex']) {
    const present = await subdirs(adapter);
    for (const name of canonical) if (!present.has(name)) dead.push(`${adapter}/${name}/`);
  }
  return dead;
}

// `docs/html/` is generated output; `docs/cycles/` is the historical execution record, where a
// cycle note correctly quotes the path that cycle's agents were told to read at the time.
const CORPUS_PRUNE = new Set(['node_modules', '.git', 'html', 'cycles']);

// Files where a dead adapter path is the SUBJECT rather than a pointer, so rewriting it destroys
// the record. Exactly two shapes have ever qualified: the plan that SPECIFIES this sweep — its
// cycle is gated on a literal grep for the dead path, so rewriting it inverts the gate into
// counting the new path — and a dated open-issues snapshot of what was broken on the day it was
// written, which rewriting would make claim a defect that never existed. Every other file naming
// a dead adapter directory holds a live pointer an agent will follow into nothing: fix the file,
// do not extend this list.
//
// It is empty because both entries it shipped with named files under
// projects/personal/u60-monitor, and that project was retired on 2026-08-06. Nothing failed when
// they went: an exemption is keyed on a path, so it dies with the file and goes on reading as
// live policy while excusing nothing. validateExemptionsResolve() below is what makes that state
// loud, so the list gets pruned by the change that retires the file rather than by whoever next
// happens to open this one.
const POINTER_EXEMPT = new Set([]);

// The exemption list is the one part of this check that cannot self-heal: everything else is
// derived from disk (deadAdapterDirs, the corpus walk), while an exemption names a literal path
// and stays behind when that path goes. Checking it against disk is the whole fix — a named file
// that is missing is an error, and the error is the prompt to prune.
//
// Skipped when the entry's own top-level directory is absent, for the same reason
// validateCanonicalPointers() skips `projects/`: the root repo gitignores the nested project
// repos, so a root-only clone — and the git worktrees the harness routinely hands to subagents —
// have none of them. Absent is an environment state, not a finding; hard-failing there produces
// false `git bisect` failures across the whole history.
async function validateExemptionsResolve() {
  const present = (rel) => access(path.join(repoRoot, rel)).then(() => true).catch(() => false);
  for (const rel of POINTER_EXEMPT) {
    if (!(await present(rel.split('/')[0]))) continue;
    if (await present(rel)) continue;
    errors.push(`POINTER_EXEMPT: ${rel} does not exist — a dead exemption excuses nothing; drop the entry in the change that removes the file`);
  }
}

async function validateCanonicalPointers() {
  const dead = await deadAdapterDirs();
  if (!dead.length) return;
  const pattern = new RegExp(dead.map((d) => d.replaceAll('.', '\\.')).join('|'), 'g');

  const corpus = [];
  async function collect(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!CORPUS_PRUNE.has(entry.name)) await collect(full);
      } else if (entry.name.endsWith('.md') || /^plan-.+\.yaml$/.test(entry.name)) {
        // Every Markdown file, not just the agent guides. The first pass of this check scanned
        // only CLAUDE.md/AGENTS.md/plan-*.yaml and reported the corpus clean while
        // tunas-lite/docs/parallel-waves.md still told an agent, verbatim, to read
        // `.claude/rules/cycle-orchestration.md` before Wave 1. A dead pointer is dead wherever
        // it is written; `cycles/` and `html/` are pruned above because those are records, not
        // instructions.
        corpus.push(full);
      }
    }
  }

  // `projects/` holds autonomous nested repositories that the root repo gitignores, so a
  // root-only clone — and the git worktrees the harness routinely hands to subagents — have no
  // project directories at all. Absent is an environment state, not a finding; hard-failing
  // there produces false `git bisect` failures across the whole history, which is exactly what
  // ec047af had to undo in the docs generator.
  const projects = path.join(repoRoot, 'projects');
  if (await access(projects).then(() => true).catch(() => false)) await collect(projects);
  // The rules and roles themselves are the highest-value place for this rot to hide.
  await collect(path.join(repoRoot, '.agents'));
  for (const guide of ['AGENTS.md', 'CLAUDE.md']) corpus.push(path.join(repoRoot, guide));

  for (const file of corpus.sort()) {
    const rel = path.relative(repoRoot, file);
    if (POINTER_EXEMPT.has(rel)) continue;
    const lines = (await readFile(file, 'utf8').catch(() => '')).split('\n');
    lines.forEach((line, index) => {
      for (const hit of new Set(line.match(pattern) || [])) {
        errors.push(`${rel}:${index + 1}: points at ${hit}, which does not exist — canonical config is .agents/${hit.split('/')[1]}/`);
      }
    });
  }
}

// Every `projects/<group>/<name>/docs/plan-*.yaml`, in a stable order. Empty in a root-only
// clone or a git worktree, where `projects/` is absent entirely — same shape as
// firstNestedRepo() above, and the group/project walks filter on isDirectory() for the same
// reason it does: `projects/` collects a `.DS_Store` on macOS, and readdir'ing that as a
// directory throws ENOTDIR and takes the whole validator down with it.
async function planFiles() {
  const projects = path.join(repoRoot, 'projects');
  const dirs = async (parent) => (await readdir(parent, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const files = [];
  for (const group of await dirs(projects)) {
    for (const project of await dirs(path.join(projects, group))) {
      const docs = path.join(projects, group, project, 'docs');
      for (const entry of await readdir(docs, { withFileTypes: true }).catch(() => [])) {
        if (entry.isFile() && /^plan-.+\.ya?ml$/.test(entry.name)) files.push(path.join(docs, entry.name));
      }
    }
  }
  return files.sort();
}

// A cycle's `primary[]` and `arch-review.reviewer` name the role that cycle dispatches to, and
// nothing checked those names against the roles that exist. In the same schema `$def` `tier` IS
// enum-restricted, so the asymmetry read as a design choice; it was oversight. 13 of 249
// `primary[]` entries did not resolve: ten `ui-ux-expert` (the role is `uiux-expert`) across
// kobu-bot/002 and isc-workflow-web 002/003/004, plus three susun-jadual entries carrying a
// parenthetical gloss (`ai-engineer (constraint formulation)`). Each named a specialist owner
// that no orchestrator could look up, and the gloss breaks the lookup exactly as badly as the
// typo does — so the annotated form is normalised in the DATA (the gloss was already carried by
// the plan's own role table and file-ownership block), never special-cased here.
//
// This guards the plan half only. `primary[]` is written in role FILENAME-STEM space
// (`uiux-expert`) while the workflows dispatch on role DISPLAY-NAME space — tdd-cycle.js takes
// `greenAgent` as a caller-supplied arg and hands it to `agentType` ("UI/UX Expert", the role's
// `name:` frontmatter), never reading the plan itself. Nothing maps one space to the other:
// plan-batch.js §Preflight asks an LLM step for "the owning implementation role defined in
// .agents/roles/" against a schema that checks only `type: 'string'`. A resolvable `primary[]`
// is therefore necessary but not sufficient — the derived display name is still unchecked.
async function validatePlanAgentRefs() {
  // `projects/` holds autonomous nested repositories the root repo gitignores; absent is an
  // environment state, not a finding. See validateCanonicalPointers() for the full reasoning.
  if (!(await access(path.join(repoRoot, 'projects')).then(() => true).catch(() => false))) return;

  // `yaml` is a tools/docs-gen dependency, resolved against THAT package: `.agents/` has no
  // node_modules and must not grow one to be validatable. Its node_modules is gitignored, so a
  // fresh clone or worktree skips this one check with a note instead of dying on
  // MODULE_NOT_FOUND — a missing dependency that reads as a broken commit makes `git bisect`
  // report false failures across the whole history. Same gate as test-agent-config.mjs.
  let YAML = null;
  try {
    YAML = createRequire(path.join(repoRoot, 'tools/docs-gen/package.json'))('yaml');
  } catch {
    console.error('note: skipping plan agent-reference check — run `npm i` in tools/docs-gen/ to enable it');
    return;
  }

  const roleDir = path.join(repoRoot, '.agents/roles');
  const roles = new Set((await markdownFiles(roleDir)).map((name) => name.replace(/\.md$/, '')));
  for (const file of await planFiles()) {
    const rel = path.relative(repoRoot, file);
    let plan;
    try {
      plan = YAML.parse(await readFile(file, 'utf8'));
    } catch (error) {
      errors.push(`${rel}: does not parse as YAML (${error.message.split('\n')[0]})`);
      continue;
    }
    for (const cycle of Array.isArray(plan?.cycles) ? plan.cycles : []) {
      const at = `${rel}: cycle ${cycle?.id ?? '(unnamed)'}`;
      const primary = cycle?.primary;
      // A bare `primary: uiux-expert` would otherwise iterate as characters and report one
      // bogus error per letter, which buries the real finding.
      if (primary !== undefined && !Array.isArray(primary)) {
        errors.push(`${at}: primary must be a list of role names, got ${typeof primary}`);
      }
      for (const name of Array.isArray(primary) ? primary : []) {
        if (!roles.has(name)) errors.push(`${at}: primary "${name}" is not a role in .agents/roles/`);
      }
      const reviewer = cycle?.['arch-review']?.reviewer;
      if (reviewer !== undefined && !roles.has(reviewer)) {
        errors.push(`${at}: arch-review.reviewer "${reviewer}" is not a role in .agents/roles/`);
      }
    }
  }
}

const claudeShim = await readFile(path.join(repoRoot, 'CLAUDE.md'), 'utf8');
if (!claudeShim.startsWith('@AGENTS.md\n')) errors.push('CLAUDE.md: must import @AGENTS.md first');

await validateRoles();
await validateSkills();
await validateClaudeSettings();
await validateClaudeRuntimeAdapters();
await validateCodexRuntimeAdapters();
await validateHookBehaviour();
await validateLinks();
await validateCanonicalPointers();
await validateExemptionsResolve();
await validatePlanAgentRefs();

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

console.log('agent config valid');
