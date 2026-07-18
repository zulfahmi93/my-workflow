#!/usr/bin/env node

import { access, readdir, readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const readOnly = ['code-reviewer.md', 'security-reviewer.md'].includes(filename);
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

async function validateClaudeRuntimeAdapters() {
  const hooks = {
    'block-commit-flags.sh': '.agents/scripts/check-commit-command.sh',
    'block-generated-html.sh': '.agents/scripts/check-generated-path.sh',
    'validate-docs-yaml.sh': '.agents/scripts/validate-docs-yaml.sh',
  };
  for (const [filename, target] of Object.entries(hooks)) {
    const source = await readFile(path.join(repoRoot, '.claude/hooks', filename), 'utf8');
    if (!source.includes(target)) errors.push(`.claude/hooks/${filename}: does not delegate to ${target}`);
  }
  for (const name of ['tdd-cycle', 'plan-batch']) {
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
function runHook(hookPath, command, cwd) {
  return new Promise((resolve) => {
    const child = execFile(hookPath, { cwd, timeout: 20000 }, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stderr: stderr ?? '' });
    });
    child.stdin.end(JSON.stringify({ tool_name: 'Bash', tool_input: { command } }));
  });
}

async function validateCommitHookBehaviour() {
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
  // root-resolution bug hides, because .agents/ lives only at the monorepo root.
  const nested = path.join(repoRoot, 'projects/personal/u60-monitor');
  const cwd = await access(nested).then(() => nested).catch(() => repoRoot);

  for (const hook of ['.claude/hooks/block-commit-flags.sh', '.codex/hooks/block-commit-flags.sh']) {
    const hookPath = path.join(repoRoot, hook);
    for (const testCase of cases) {
      const { code, stderr } = await runHook(hookPath, testCase.command, cwd);
      if (code !== testCase.expect) {
        errors.push(
          `${hook}: ${testCase.name} — expected exit ${testCase.expect}, got ${code}` +
          (stderr.trim() ? ` (${stderr.trim().split('\n')[0]})` : ''),
        );
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

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const raw = match[1];
      if (/^(https?:|mailto:|#)/.test(raw) || raw.includes('<')) continue;
      const target = raw.split('#', 1)[0];
      if (!target) continue;
      const resolved = path.resolve(path.dirname(file), target);
      await access(resolved).catch(() => errors.push(`${path.relative(repoRoot, file)}: missing link target ${raw}`));
    }
  }
}

const claudeShim = await readFile(path.join(repoRoot, 'CLAUDE.md'), 'utf8');
if (!claudeShim.startsWith('@AGENTS.md\n')) errors.push('CLAUDE.md: must import @AGENTS.md first');

await validateRoles();
await validateSkills();
await validateClaudeRuntimeAdapters();
await validateCodexRuntimeAdapters();
await validateCommitHookBehaviour();
await validateLinks();

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

console.log('agent config valid');
