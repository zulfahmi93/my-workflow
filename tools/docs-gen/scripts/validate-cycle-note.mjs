// validate-cycle-note.mjs — standalone validator for per-cycle execution records.
//
// Cycle notes (projects/<group>/<name>/docs/cycles/<X.Y>.yaml) are EXECUTION-ONLY: they are not part
// of the docs-gen build (generate.mjs never reads them) and are not rendered into the HTML site.
// This script is the ajv gate the orchestrator runs at cycle close, mirroring `npm run validate`
// for plan YAMLs.
//
// Checks:
//   1. JSON Schema (cycle-note.schema.json, draft 2020-12) — required fields, enums, types,
//      additionalProperties:false, the security-tier → threat-model conditional require, and
//      the self-review rejection on every reviewer-agent-id.
//   2. Filename ↔ content: the `cycle:` field must match the <X.Y> in the filename.
//   3. review-passes ↔ reviewer-findings coherence, when the optional roster is present:
//      every pass that produced findings must appear in the roster, and no pass twice.
//
// Usage (from tools/docs-gen/; relative paths resolve against the repo root, like the no-arg glob):
//   node scripts/validate-cycle-note.mjs <path...>      # validate the given files
//   node scripts/validate-cycle-note.mjs                # validate all grouped project cycle notes
//   npm run validate-cycle-note -- projects/<group>/<name>/docs/cycles/<X.Y>.yaml
//
// Exits 1 on any violation so it can gate a commit.

import { readFileSync, globSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { parseYamlDoc } from '../lib/load-yaml-source.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '..', 'schema', 'cycle-note.schema.json');
const REPO_ROOT = join(__dirname, '..', '..', '..');

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
const validate = ajv.compile(schema);

function validateOne(absPath) {
  const errors = [];
  const doc = parseYamlDoc(absPath);

  if (!validate(doc)) {
    for (const e of validate.errors) {
      const path = e.instancePath || '(root)';
      // ajv renders a failed `not` as "must NOT be valid", which says nothing about why.
      // The only `not` in this schema is the self-review rejection, and it is the one
      // failure a human most needs an actionable message for.
      if (e.keyword === 'not' && path.endsWith('/reviewer-agent-id')) {
        errors.push(
          `${path} must not be a self-review — the orchestrator reviewing its own work is ` +
          'non-compliant (cycle-orchestration.md §Permitted orchestrator-side reads). ' +
          'Record the fresh reviewer agent, e.g. "wf:<runId>/review-pass-<N>".',
        );
        continue;
      }
      const extra = e.params && e.params.additionalProperty ? ` ("${e.params.additionalProperty}")`
        : e.params && e.params.allowedValues ? ` (allowed: ${e.params.allowedValues.join(', ')})` : '';
      errors.push(`${path} ${e.message}${extra}`);
    }
  }

  // filename ↔ content: <X.Y>.yaml must match `cycle:`
  const fileId = basename(absPath).replace(/\.ya?ml$/, '');
  if (doc && doc.cycle && doc.cycle !== fileId) {
    errors.push(`filename "${fileId}.yaml" does not match cycle: "${doc.cycle}"`);
  }

  // review-passes ↔ reviewer-findings coherence. Only checked when review-passes is
  // present, so notes filed before the field existed stay valid — but once a roster is
  // supplied it must be complete, or it gives a false sense of attribution: a pass that
  // produced findings yet appears in no roster entry is exactly the gap the field exists
  // to close.
  if (doc && Array.isArray(doc['review-passes'])) {
    const roster = new Set(doc['review-passes'].map((p) => p && p.pass));
    const findingPasses = new Set(
      (Array.isArray(doc['reviewer-findings']) ? doc['reviewer-findings'] : [])
        .map((f) => f && f.pass)
        .filter((p) => p !== undefined),
    );
    for (const p of [...findingPasses].sort((a, b) => a - b)) {
      if (!roster.has(p)) {
        errors.push(`reviewer-findings reference pass ${p}, but review-passes has no entry for it`);
      }
    }
    const seen = new Set();
    for (const p of doc['review-passes']) {
      if (!p || p.pass === undefined) continue;
      if (seen.has(p.pass)) errors.push(`review-passes has duplicate entries for pass ${p.pass}`);
      seen.add(p.pass);
    }
  }

  return errors;
}

const args = process.argv.slice(2);
const files = args.length
  ? args.map((a) => (isAbsolute(a) ? a : resolve(REPO_ROOT, a)))
  : [
      ...globSync('projects/*/*/docs/cycles/*.{yaml,yml}', { cwd: REPO_ROOT }),
      ...globSync('projects/*/docs/cycles/*.{yaml,yml}', { cwd: REPO_ROOT }),
    ].map((p) => join(REPO_ROOT, p));

if (!files.length) {
  console.log('no cycle-note YAML files found — nothing to validate.');
  process.exit(0);
}

let failed = 0;
for (const f of files) {
  const errors = validateOne(f);
  if (errors.length) {
    failed += errors.length;
    console.error(`✗ ${f} (${errors.length} error${errors.length === 1 ? '' : 's'}):`);
    for (const e of errors) console.error(`    ${e}`);
  } else {
    console.log(`✓ ${f}`);
  }
}

if (failed) {
  console.error(`\ncycle-note validation FAILED (${failed} error${failed === 1 ? '' : 's'}).`);
  process.exit(1);
}
console.log(`\nall ${files.length} cycle-note file${files.length === 1 ? '' : 's'} valid.`);
