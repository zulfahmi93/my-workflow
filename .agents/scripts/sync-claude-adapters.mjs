#!/usr/bin/env node

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function frontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error('missing YAML frontmatter');
  return match[1];
}

function fieldLines(block, names) {
  return block
    .split('\n')
    .filter((line) => names.some((name) => line.startsWith(`${name}:`)));
}

async function syncRoles() {
  const sourceDir = path.join(repoRoot, '.agents/roles');
  const adapterDir = path.join(repoRoot, '.claude/agents');
  const canonicalFiles = (await readdir(sourceDir)).filter((name) => name.endsWith('.md')).sort();
  const adapterFiles = (await readdir(adapterDir)).filter((name) => name.endsWith('.md')).sort();
  const orphans = adapterFiles.filter((name) => !canonicalFiles.includes(name));
  if (orphans.length) throw new Error(`orphan Claude role adapters: ${orphans.join(', ')}`);
  for (const filename of canonicalFiles) {
    const canonical = await readFile(path.join(sourceDir, filename), 'utf8');
    const currentAdapter = await readFile(path.join(adapterDir, filename), 'utf8').catch(() => '');
    const neutral = fieldLines(frontmatter(canonical), ['name', 'description']);
    const claude = currentAdapter
      ? fieldLines(frontmatter(currentAdapter), ['color', 'emoji', 'vibe', 'tools', 'model'])
      : [];
    const output = `---\n${[...neutral, ...claude].join('\n')}\n---\n\n` +
      `# Claude Code adapter\n\n` +
      `Read \`.agents/roles/${filename}\` in full, then follow it as the canonical role definition. ` +
      `Resolve shared operating rules under \`.agents/rules/\`.\n`;
    await writeFile(path.join(adapterDir, filename), output);
  }
}

async function syncSkills() {
  const sourceDir = path.join(repoRoot, '.agents/skills');
  const adapterDir = path.join(repoRoot, '.claude/skills');
  const canonicalDirs = (await readdir(sourceDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const adapterDirs = (await readdir(adapterDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const orphans = adapterDirs.filter((name) => !canonicalDirs.includes(name));
  if (orphans.length) throw new Error(`orphan Claude skill adapters: ${orphans.join(', ')}`);
  for (const dirname of canonicalDirs) {
    const canonicalPath = path.join(sourceDir, dirname, 'SKILL.md');
    const canonical = await readFile(canonicalPath, 'utf8').catch(() => null);
    if (!canonical) continue;
    await mkdir(path.join(adapterDir, dirname), { recursive: true });
    const output = `---\n${frontmatter(canonical)}\n---\n\n` +
      `# Claude Code adapter\n\n` +
      `Read \`.agents/skills/${dirname}/SKILL.md\` in full and follow it as the canonical skill.\n`;
    await writeFile(path.join(adapterDir, dirname, 'SKILL.md'), output);
  }
}

await syncRoles();
await syncSkills();
