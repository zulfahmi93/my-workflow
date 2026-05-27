// load-yaml-source.mjs — single-file YAML source → the internal model the renderers/
// templates consume. This is the generator's ONLY source loader (the legacy MD-triad
// parsers were removed; the YAML is the single source of truth).
//
// The YAML uses kebab-case keys throughout (one-liner, critical-path, arch-review,
// file-ownership, …). It is the deduplicated source of truth: a cycle's id/title/owner/
// deps/status/file-ownership/phases/session-prompt live ONCE under that cycle. The progress
// table, dependency DAG, batch-summary table, and file-ownership matrix are VIEWS derived
// here from cycles[] + batches[]. Runbook prose that is not cycle-scoped lives under
// `runbook`. Verbatim fields (phase code src, session prompts, worktree bash) pass through
// untouched — never near the markdown renderer.
//
// Validation (schema + referential integrity) runs in validate-source.mjs BEFORE this loads.

import { readFileSync } from 'node:fs';
import YAML from 'yaml';

export function parseYamlDoc(absPath) {
  return YAML.parse(readFileSync(absPath, 'utf8'));
}

export function loadYamlSource(absPath) {
  const doc = parseYamlDoc(absPath);

  const plan = buildPlanModel(doc);          // h1, context, overviewExtras, cycles[], tables
  const progress = buildProgressModel(doc);  // byId, order[], counts (donut + status table)
  const meta = buildMetaModel(doc);          // graph data: cycles deps, batches, criticalPath, fileOwnership
  const batches = buildBatchesModel(doc);    // runbook: h1, intro, sections[], batch groups + sessions

  return { id: doc.id, doc, plan, progress, meta, batches, hasBatches: !!batches, hasMeta: !!meta };
}

// ---------------------------------------------------------------------------
// plan model: { h1, context, overviewExtras, cycles[], openQuestions, followups }
// cycle: { id, title, owner, archReview:{tier,reason,deferTo?}, closes, dependsOn,
//          noTdd, securityTier, scope, phases:[{name,meta,prose,code:[{lang,text}]}] }
// ---------------------------------------------------------------------------
function buildPlanModel(doc) {
  const ov = doc.overview || {};
  const cycles = (doc.cycles || []).map((c) => ({
    id: c.id,
    title: c.title,
    owner: (c.primary || []).join(' + '),
    archReview: archReviewModel(c['arch-review'] || {}),
    closes: c.closes || '',
    dependsOn: '', // deps are structural (c.deps); no inline "Depends on:" prose in YAML
    noTdd: !!c['no-tdd'],
    securityTier: !!c['security-tier'],
    scope: c.scope || '',
    phases: phasesModel(c.phases || {}),
  }));
  return {
    h1: doc.title,
    context: ov.context || '',
    // D4: extra overview prose, rendered as its own sections on the overview page after
    // Context. The MD path never surfaced these; the YAML now does — by design.
    // Two forms, both supported + concatenated in order:
    //   1. named keys (kept for back-compat): stack, tdd-cycle-format, plan-003-note
    //   2. a general ordered list `extra-sections[]` of { id, heading, body } so any plan
    //      can carry its own arbitrary prose (susun's Core concept / Project root / Phases).
    overviewExtras: buildOverviewExtras(ov),
    cycles,
    openQuestions: tableModel(doc['open-questions']),
    followups: tableModel(doc['cycle-followups']),
  };
}

// Ordered list of { id, heading, body } for the overview-extra sections.
function buildOverviewExtras(ov) {
  const out = [];
  if (ov.stack) out.push({ id: 'stack', heading: 'Stack', body: ov.stack });
  if (ov['tdd-cycle-format']) out.push({ id: 'tdd-cycle-format', heading: 'TDD cycle format', body: ov['tdd-cycle-format'] });
  if (ov['plan-003-note']) out.push({ id: 'plan-003-note', heading: 'Plan-003 dependency', body: ov['plan-003-note'] });
  for (const s of ov['extra-sections'] || []) {
    out.push({ id: s.id || slugify(s.heading), heading: s.heading || s.id, body: s.body || '' });
  }
  return out;
}

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^\w]+/g, '-').replace(/(^-|-$)/g, '');
}

function archReviewModel(a) {
  if (!a || !a.state) return { tier: 'none', reason: '' };
  if (a.state === 'none') return { tier: 'none', reason: a.reason || '' };
  if (a.state === 'deferred') return { tier: 'deferred', reason: a.reason || '', deferTo: a['deferred-to'] || '' };
  return { tier: a.tier || 'opus', reason: a.reason || '' };
}

function phasesModel(phases) {
  const order = ['red', 'green', 'review', 'refactor', 'security-review'];
  const out = [];
  for (const key of order) {
    const p = phases[key];
    if (!p) continue;
    const meta = p['meta-raw'] != null ? p['meta-raw'] : (p.model && p.agent ? `\`${p.model}\` - \`${p.agent}\`` : '');
    out.push({
      name: key.toUpperCase(),
      meta,
      prose: p.body || '',
      code: (p.code || []).map((c) => ({ lang: c.lang || 'text', text: c.src != null ? c.src : (c.text || '') })),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// progress model: { byId, order[], counts }   (drives donut + status table)
// D1: the status table/dashboard renders the cycle title (no separate progress-desc).
// ---------------------------------------------------------------------------
function buildProgressModel(doc) {
  const byId = {};
  const order = [];
  for (const c of doc.cycles || []) {
    byId[c.id] = {
      desc: c.title || '',
      status: c.status || 'idle',
      statusLabel: statusLabel(c.status || 'idle'),
      shipped: c.shipped || '—',
      notes: c.notes || '—',
    };
    order.push(c.id);
  }
  const counts = { ok: 0, wip: 0, idle: 0, total: 0 };
  for (const v of Object.values(byId)) { counts[v.status] = (counts[v.status] || 0) + 1; counts.total++; }
  return { byId, order, counts };
}

function statusLabel(s) {
  return s === 'ok' ? 'Shipped' : s === 'wip' ? 'In progress' : 'Not started';
}

// ---------------------------------------------------------------------------
// meta model: { id, title, oneLiner, cycles:[{id,deps}], batches:[…], criticalPath,
//               wallTimeSaved, fileOwnership:[{cycle,dirs,newFiles}] }
// (drives DAG, batch-timeline, file-ownership matrix)
// ---------------------------------------------------------------------------
function buildMetaModel(doc) {
  return {
    id: doc.id,
    title: doc.title,
    oneLiner: doc['one-liner'] || '',
    cycles: (doc.cycles || []).map((c) => ({ id: c.id, deps: c.deps || [] })),
    batches: (doc.batches || []).map((b) => ({ id: b.id, cycles: b.cycles || [], wallTime: b['wall-time'] || '', notes: b.notes || '' })),
    criticalPath: doc['critical-path'] || [],
    wallTimeSaved: doc['wall-time-saved'] || '',
    fileOwnership: (doc.cycles || [])
      .map((c) => ({ id: c.id, fo: c['file-ownership'] }))
      .filter((x) => x.fo && ((x.fo.dirs || []).length || (x.fo['new-files'] || []).length))
      .map((x) => ({ cycle: x.id, dirs: x.fo.dirs || [], newFiles: x.fo['new-files'] || [] })),
  };
}

// ---------------------------------------------------------------------------
// batches model: { h1, intro, sections:[{heading,body}], batches:[{id,heading,intro,sessions[]}] }
// ---------------------------------------------------------------------------
function buildBatchesModel(doc) {
  const rb = doc.runbook || {};
  const h1 = rb.h1 || `Parallel Batch Orchestration — plan-${doc.id}`;

  const sections = [];
  const add = (heading, body) => sections.push({ heading, body: body || '' });
  if (rb['how-to-use']) add('How to use', rb['how-to-use']);
  if (rb['common-contract']) add('Common contract (applies to every session)', rb['common-contract']);
  if (rb['worktree-convention']) add('Worktree convention', rb['worktree-convention']);
  if (rb['merge-protocol']) add('Merge protocol', rb['merge-protocol']);
  add('Batch summary', batchSummaryBody(doc, rb)); // derived GFM table + critical-path note
  if (rb['file-ownership-notes']) add('File ownership map (conflict avoidance)', rb['file-ownership-notes']);
  if (rb['inter-batch-verification']) add('Inter-batch verification', rb['inter-batch-verification']);
  if (rb['stop-conditions']) add('Stop conditions (across all batches)', rb['stop-conditions']);
  if (rb['final-state']) add(rb['final-state-heading'] || 'Final state', rb['final-state']);

  // Index each cycle's session by cycle id, then order sessions PER BATCH by the batch's
  // own `cycles[]` order (the source session order) — not by cycle-iteration order, so the
  // runbook page lists sessions exactly as the source batches file did.
  const cycleById = {};
  for (const c of doc.cycles || []) cycleById[c.id] = c;
  const sessionFor = (id) => {
    const c = cycleById[id];
    if (!c || !c.session) return null;
    return { title: c.session.title || `Cycle ${id}`, cycleId: id, prompt: c.session.prompt || '', before: c.session.before || '', after: c.session.after || '' };
  };
  const batchGroups = (doc.batches || []).map((b) => ({
    id: b.id,
    heading: b.heading || b.id,
    intro: b.intro || '',
    sessions: (b.cycles || []).map(sessionFor).filter(Boolean),
  }));

  return { h1, intro: rb.intro || '', sections, batches: batchGroups };
}

// D2: a single `notes` field per batch holds the rich value used by both the timeline
// (meta) and this summary table.
function batchSummaryBody(doc, rb) {
  const header = `| Batch | Sessions | Wall-time hint | Notes |\n|---|---|---|---|`;
  const rows = (doc.batches || [])
    .map((b) => `| **${b.id}** | ${(b.cycles || []).join(' ‖ ')} | ${b['wall-time'] || ''} | ${b.notes || ''} |`)
    .join('\n');
  const note = rb['batch-summary-note'] ? `\n\n${rb['batch-summary-note']}` : '';
  return `${header}\n${rows}${note}`;
}

// ---------------------------------------------------------------------------
// table model (open questions / follow-ups): { headers[], rows[][], placeholder }
// Accepts the structured form { headers, placeholder, rows:[{col:val}] } or a bare array.
// ---------------------------------------------------------------------------
function tableModel(src) {
  const structured = src && !Array.isArray(src) ? src : { rows: src || [], headers: [], placeholder: '' };
  const rowObjs = structured.rows || [];
  if (rowObjs.length === 0) {
    return { headers: structured.headers || [], rows: [], placeholder: structured.placeholder || '' };
  }
  const headers = structured.headers && structured.headers.length ? structured.headers : Object.keys(rowObjs[0]);
  const rows = rowObjs.map((o) =>
    headers.map((h) => {
      const key = h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      return o[h] != null ? String(o[h]) : (o[key] != null ? String(o[key]) : '');
    })
  );
  return { headers, rows, placeholder: '' };
}
