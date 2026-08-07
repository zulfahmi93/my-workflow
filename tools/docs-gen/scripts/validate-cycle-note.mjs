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
//      the reviewer-id constraints: the canonical grammar on every review-passes[] entry (and,
//      once a note carries that roster, on its reviewer-findings[] ids too), the `wf:`-prefixed
//      subset plus the residual self-review filter on legacy reviewer-findings[] ids.
//   2. Filename ↔ content: the `cycle:` field must match the <X.Y> in the filename.
//   3. review-passes ↔ reviewer-findings coherence, when the optional roster is present:
//      every pass that produced findings must appear in the roster, and no pass twice.
//   4. Reviewer attribution: a note must name at least one reviewer somewhere machine-readable
//      — non-empty reviewer-findings[] or a non-empty review-passes[] roster. A clean APPROVED
//      pass that names nobody is the one self-review shape the rules cannot otherwise detect.
//      Five historical notes predate this and are grandfathered by path; see below.
//
// Warnings (printed, never fatal) flag notes that pass but carry no review-passes[] roster,
// which cycle-orchestration.md §Reviewer separation records as a MUST.
//
// Usage (from tools/docs-gen/; relative paths resolve against the repo root, like the no-arg glob):
//   node scripts/validate-cycle-note.mjs <path...>      # validate the given files
//   node scripts/validate-cycle-note.mjs                # validate all grouped project cycle notes
//   npm run validate-cycle-note -- projects/<group>/<name>/docs/cycles/<X.Y>.yaml
//
// Exits 1 on any violation so it can gate a commit.

import { readFileSync, globSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { parseYamlDoc } from '../lib/load-yaml-source.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '..', 'schema', 'cycle-note.schema.json');
const REPO_ROOT = join(__dirname, '..', '..', '..');

// Check 4 (reviewer attribution) grandfathers exactly these five notes. Each has
// `reviewer-findings: []`, no roster, and names its reviewer — if at all — only in
// `outcome.summary` prose. They are historical execution records and are NOT rewritten.
// isc-workflow-web 2.9 is the incident that motivated the check: a REFACTOR pass deleted its
// one finding (reviewer-agent-id "technical-writer (self-audit; no code-reviewer spawned …)")
// as non-compliant, leaving an empty array that then validated clean — the note itself says
// "the formal REVIEW pass by a fresh code-reviewer has not yet been recorded".
// Grandfathered by exact repo-relative path so the list can only shrink: any NEW note that
// names no reviewer fails. Do not add to it.
const ATTRIBUTION_GRANDFATHERED = new Set([
  'projects/rintis/isc-workflow-web/docs/cycles/2.9.yaml',
  'projects/rintis/kobu-bot/docs/cycles/001.2.yaml',
  'projects/rintis/kobu-bot/docs/cycles/002.11.yaml',
  'projects/rintis/kobu-bot/docs/cycles/002.36.yaml',
  'projects/rintis/landing-website/docs/cycles/0.1.yaml',
]);

const CANONICAL_ID_HELP =
  'expected a canonical reviewer id — "wf:<runId>/review-pass-<N>" as tdd-cycle.js emits it ' +
  '(e.g. wf:wf_ac45c2a0-883/review-pass-1; "security-pass-<N>" for the security-tier second pass), ' +
  'or a bare Agent-tool id "a" + 16 hex (e.g. a3c94389c274c9715) on the manual path. ' +
  'Free prose names no verifiable agent — put role / verdict / pass narration in the role, ' +
  'verdict and findings-count fields.';

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
const validate = ajv.compile(schema);

function validateOne(absPath) {
  const errors = [];
  const warnings = [];
  const doc = parseYamlDoc(absPath);

  if (!validate(doc)) {
    for (const e of validate.errors) {
      const path = e.instancePath || '(root)';
      const isReviewerId = path.endsWith('/reviewer-agent-id');
      // ajv renders a failed `not` as "must NOT be valid", which says nothing about why.
      // The only `not` in this schema is the self-review rejection, and it is the one
      // failure a human most needs an actionable message for.
      if (e.keyword === 'not' && isReviewerId) {
        errors.push(
          `${path} must not be a self-review — the orchestrator reviewing its own work is ` +
          'non-compliant (cycle-orchestration.md §Permitted orchestrator-side reads). ' +
          'Record the fresh reviewer agent, e.g. "wf:<runId>/review-pass-<N>".',
        );
        continue;
      }
      // The reviewer-id `pattern` is the positive constraint that replaced a keyword filter
      // which had never rejected anything; ajv's bare "must match pattern /^(?:wf:…/" dumps the
      // regex at the author instead of telling them what to write.
      if (e.keyword === 'pattern' && isReviewerId) {
        errors.push(`${path} ${CANONICAL_ID_HELP}`);
        continue;
      }
      // ajv reports a failed conditional twice: the real error from inside `then`, and an
      // `if` wrapper whose message is the content-free "must match "then" schema". Both
      // conditionals here (security-tier → threat-model, roster → canonical ids) always emit
      // the inner error, so dropping the wrapper loses nothing and stops the useful message
      // arriving with a meaningless twin.
      if (e.keyword === 'if') continue;
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

  // Reviewer attribution. reviewer-agent-id is required on every entry of both arrays, so a
  // note names SOMEBODY iff at least one of them is non-empty. A note with neither is the case
  // the self-review rule is blindest to: a clean APPROVED pass produces no finding, so an
  // orchestrator that reviewed its own GREEN leaves a note indistinguishable from a compliant
  // one. Empty `review-passes: []` does not count — a roster with no entries names no one.
  const findings = doc && Array.isArray(doc['reviewer-findings']) ? doc['reviewer-findings'] : [];
  const passes = doc && Array.isArray(doc['review-passes']) ? doc['review-passes'] : null;
  const relPath = relative(REPO_ROOT, absPath).split(sep).join('/');
  if (doc && !findings.length && !(passes && passes.length)) {
    if (ATTRIBUTION_GRANDFATHERED.has(relPath)) {
      warnings.push(
        'names no reviewer in any machine-readable field — grandfathered as a historical ' +
        'record (see ATTRIBUTION_GRANDFATHERED in this script). Not valid for new notes.',
      );
    } else {
      errors.push(
        'names no reviewer: reviewer-findings is empty and there is no review-passes[] roster. ' +
        'A clean APPROVED pass that names nobody is exactly the self-review case ' +
        'cycle-orchestration.md §Reviewer separation cannot otherwise detect. Add review-passes[] ' +
        '— one entry per REVIEW pass, zero-finding passes included.',
      );
    }
  } else if (doc && !passes) {
    warnings.push(
      'review-passes[] roster missing — cycle-orchestration.md §Reviewer separation makes it a ' +
      'MUST ("Record every REVIEW pass … including passes that returned zero findings"). ' +
      'reviewer-findings names a reviewer only for passes that produced a finding.',
    );
  }

  return { errors, warnings };
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
let warned = 0;
// Warnings are per-note nudges, useful at cycle close (the orchestrator validates one file).
// Across the whole corpus almost every note predates review-passes[], so printing each one
// buries the ✗ lines under a wall of "this note is historical" — collapse to a tail count.
const showWarnings = files.length <= 10;
for (const f of files) {
  const { errors, warnings } = validateOne(f);
  warned += warnings.length;
  if (errors.length) {
    failed += errors.length;
    console.error(`✗ ${f} (${errors.length} error${errors.length === 1 ? '' : 's'}):`);
    for (const e of errors) console.error(`    ${e}`);
  } else {
    console.log(`✓ ${f}`);
  }
  if (showWarnings) for (const w of warnings) console.warn(`    ! ${w}`);
}

if (failed) {
  console.error(`\ncycle-note validation FAILED (${failed} error${failed === 1 ? '' : 's'}).`);
  process.exit(1);
}
console.log(`\nall ${files.length} cycle-note file${files.length === 1 ? '' : 's'} valid.`);
if (warned && !showWarnings) {
  console.warn(`${warned} warning${warned === 1 ? '' : 's'} (non-fatal) — re-run on a single file to see them.`);
}
