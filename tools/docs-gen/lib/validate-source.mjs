// validate-source.mjs — declarative + referential validation for a single-file plan YAML.
//
// 1. JSON Schema (ajv, draft 2020-12): required fields, enums, types, additionalProperties:false
//    so a typo'd / unknown key or a misindented block scalar (wrong type) fails loudly.
// 2. Referential integrity (ajv can't express cross-references): every deps[], critical-path[],
//    and batches[].cycles[] entry must reference an existing cycle id.
//
// Throws ValidationError (with a formatted, multi-line message) on any violation, so the
// build aborts before rendering instead of silently mis-rendering.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js'; // draft 2020-12 build (bundles the 2020-12 meta-schema)
import { parseYamlDoc } from './load-yaml-source.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '..', 'schema', 'plan.schema.json');

export class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; }
}

let _validate = null;
function getValidator() {
  if (_validate) return _validate;
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  _validate = ajv.compile(schema);
  return _validate;
}

// Validate a parsed YAML doc. Returns the doc on success; throws ValidationError on failure.
export function validateDoc(doc, label = 'plan.yaml') {
  const errors = [];

  // ---- 1. schema ----
  const validate = getValidator();
  if (!validate(doc)) {
    for (const e of validate.errors) {
      const path = e.instancePath || '(root)';
      const extra = e.params && e.params.additionalProperty ? ` ("${e.params.additionalProperty}")`
        : e.params && e.params.allowedValues ? ` (allowed: ${e.params.allowedValues.join(', ')})` : '';
      errors.push(`${path} ${e.message}${extra}`);
    }
  }

  // ---- 2. referential integrity ----
  const ids = new Set((doc.cycles || []).map((c) => c.id));
  const ref = (label2, val, where) => {
    if (val == null) return;
    if (!ids.has(val)) errors.push(`${where} → unknown cycle id "${val}" (not in cycles[])`);
  };
  (doc.cycles || []).forEach((c, i) => {
    (c.deps || []).forEach((d, j) => ref('dep', d, `/cycles/${i} (${c.id}) /deps/${j}`));
    if (c.batch != null && !(doc.batches || []).some((b) => b.id === c.batch)) {
      errors.push(`/cycles/${i} (${c.id}) /batch → unknown batch id "${c.batch}" (not in batches[])`);
    }
  });
  (doc['critical-path'] || []).forEach((cid, i) => ref('crit', cid, `/critical-path/${i}`));
  (doc.batches || []).forEach((b, i) => {
    (b.cycles || []).forEach((cid, j) => ref('batch-cycle', cid, `/batches/${i} (${b.id}) /cycles/${j}`));
  });

  if (errors.length) {
    const lines = errors.map((e) => `  ✗ ${e}`).join('\n');
    throw new ValidationError(`Schema/integrity validation FAILED for ${label} (${errors.length} error${errors.length === 1 ? '' : 's'}):\n${lines}`);
  }
  return doc;
}

// Convenience: validate a YAML file by path.
export function validateFile(absPath, label) {
  return validateDoc(parseYamlDoc(absPath), label || absPath);
}
