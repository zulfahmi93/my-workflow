#!/usr/bin/env node

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceDir = path.join(repoRoot, '.agents/roles');
const adapterDir = path.join(repoRoot, '.codex/agents');

function parseRole(source, filename) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${filename}: missing YAML frontmatter`);
  const name = match[1].match(/^name:\s*(.+)$/m)?.[1];
  const description = match[1].match(/^description:\s*(.+)$/m)?.[1];
  if (!name || !description) throw new Error(`${filename}: missing name or description`);
  return { name, description, body: match[2].trim() };
}

function codexName(filename) {
  return filename.replace(/\.md$/, '').replaceAll('-', '_').replaceAll('.', 'dot');
}

await mkdir(adapterDir, { recursive: true });
const canonicalFiles = (await readdir(sourceDir)).filter((name) => name.endsWith('.md')).sort();
const adapterFiles = (await readdir(adapterDir)).filter((name) => name.endsWith('.toml')).sort();
const expectedFiles = canonicalFiles.map((name) => name.replace(/\.md$/, '.toml'));
const orphans = adapterFiles.filter((name) => !expectedFiles.includes(name));
if (orphans.length) throw new Error(`orphan Codex role adapters: ${orphans.join(', ')}`);

for (const filename of canonicalFiles) {
  const source = await readFile(path.join(sourceDir, filename), 'utf8');
  const role = parseRole(source, filename);
  const adapterName = codexName(filename);
  const instructions = `Canonical role: .agents/roles/${filename}\nResolve relative paths and Markdown links from that canonical file.\n\n${role.body}`;
  const readOnly = ['code-reviewer.md', 'security-reviewer.md'].includes(filename);
  const output = [
    `name = ${JSON.stringify(adapterName)}`,
    `description = ${JSON.stringify(role.description)}`,
    ...(readOnly ? ['sandbox_mode = "read-only"'] : []),
    `developer_instructions = ${JSON.stringify(instructions)}`,
    '',
  ].join('\n');
  await writeFile(path.join(adapterDir, filename.replace(/\.md$/, '.toml')), output);
}
