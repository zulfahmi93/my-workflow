#!/usr/bin/env node
// generate.mjs — shared, config-driven docs generator (repo-root tool).
//
//   node generate.mjs [--watch] [project] [plan]
//
// Iterates tools/docs-gen/projects.config.json. Each project declares a docsRoot,
// an outDir, a per-project site config (brand/accent/theme-key/landing copy), and a
// list of plans. Each plan is a single validated YAML source (plan-<id>.yaml) holding
// cycles, prompts, diagram graph, and status in one file. For every plan it writes
// <outDir>/<id>/{index,plan,batches?}.html plus a per-project <outDir>/index.html
// landing. Shared assets (style.css, app.js) are copied into each project's
// <outDir>/assets/ so every project site is self-contained + portable.
//
// Repo root is resolved RELATIVE to this file (tools/docs-gen/ → ../..); no absolute
// home paths are hardcoded.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadYamlSource, parseYamlDoc } from './lib/load-yaml-source.mjs';
import { validateDoc } from './lib/validate-source.mjs';
import * as T from './lib/templates.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = __dirname;
const REPO_ROOT = resolve(__dirname, '..', '..'); // tools/docs-gen → repo root
const ASSETS_SRC = join(TOOL_DIR, 'assets');
const SITES_DIR = join(TOOL_DIR, 'sites');
const REGISTRY = join(TOOL_DIR, 'projects.config.json');

// ---------------------------------------------------------------------------
// config + IO
// ---------------------------------------------------------------------------
function loadRegistry() {
  return JSON.parse(readFileSync(REGISTRY, 'utf8')).projects;
}

function loadSite(siteFile) {
  return JSON.parse(readFileSync(join(SITES_DIR, siteFile), 'utf8'));
}

function sourceExists(docsRoot, name) {
  return !!name && existsSync(join(REPO_ROOT, docsRoot, name));
}

// Load one plan from its single YAML source. The generator is YAML-only: `plan-<id>.yaml`
// (or the registry's `yaml:` field) is validated (schema + referential integrity) then
// loaded into the internal model via load-yaml-source.mjs. A missing YAML is a hard error —
// the legacy MD-triad (plan / progress / batches + meta) format was removed.
function loadPlan(project, planCfg, opts = {}) {
  const { docsRoot } = project;
  const yamlName = planCfg.yaml || `plan-${planCfg.id}.yaml`;

  if (!sourceExists(docsRoot, yamlName)) {
    throw new Error(
      `no ${yamlName} found in ${docsRoot}; the MD-triad format was removed — ` +
      `author a YAML source per tools/docs-gen/README.md + .agents/rules/docs-site.md`
    );
  }

  const yamlPath = join(REPO_ROOT, docsRoot, yamlName);
  validateDoc(parseYamlDoc(yamlPath), `${project.name}/${yamlName}`); // throws on violation → build aborts
  const y = loadYamlSource(yamlPath);
  const promptCount = y.batches ? y.batches.batches.reduce((n, b) => n + b.sessions.filter((s) => s.prompt).length, 0) : 0;
  const batches = y.batches && (promptCount > 0 || y.batches.batches.length > 0) ? y.batches : null;
  return {
    id: planCfg.id,
    cfg: { ...planCfg, sourceKind: 'yaml', sourceName: yamlName },
    meta: y.meta,
    plan: y.plan,
    progress: y.progress,
    batches,
    hasBatches: !!batches,
    hasMeta: !!y.meta,
  };
}

// ============================================================
// Build one project → <outDir>/<id>/{…}.html + <outDir>/index.html
// ============================================================
function buildProject(project, onlyPlanId = null, opts = {}) {
  const site = loadSite(project.site);
  // Compare-dir override: build YAML output beside the live html/ without touching it.
  const outRel = opts.outDir || project.outDir;
  const outAbs = join(REPO_ROOT, outRel);
  mkdirSync(outAbs, { recursive: true });
  copyAssets(outAbs);

  // Every plan's data is needed for the landing; render pages only for targeted plan(s).
  const planData = project.plans.map((pc) => loadPlan(project, pc, opts));

  for (const pd of planData) {
    if (onlyPlanId && pd.id !== onlyPlanId) continue;
    renderPlanPages(project, site, pd, outAbs);
    console.log(`  ✓ ${project.name}/plan-${pd.id} → ${outRel}/${pd.id}/{index,plan${pd.hasBatches ? ',batches' : ''}}.html`);
  }

  writeFileSync(join(outAbs, 'index.html'), renderLanding(project, site, planData));
  console.log(`  ✓ ${project.name} landing → ${outRel}/index.html`);
}

function copyAssets(outAbs) {
  const dst = join(outAbs, 'assets');
  mkdirSync(dst, { recursive: true });
  for (const f of readdirSync(ASSETS_SRC)) copyFileSync(join(ASSETS_SRC, f), join(dst, f));
}

// ============================================================
// Per-plan pages
// ============================================================
function renderPlanPages(project, site, pd, outAbs) {
  const planDir = join(outAbs, pd.id);
  mkdirSync(planDir, { recursive: true });

  const navLinks = (current) => {
    const links = [
      { label: 'All plans', href: '../index.html' },
      { label: 'Overview', href: 'index.html', current: current === 'index' },
      { label: 'Cycles', href: 'plan.html', current: current === 'plan' },
    ];
    if (pd.hasBatches) links.push({ label: 'Parallel runbook', href: 'batches.html', current: current === 'batches' });
    return { home: '../index.html', tag: `plan-${pd.id}`, links };
  };

  writeFileSync(join(planDir, 'index.html'), renderOverview(project, site, pd, navLinks('index')));
  writeFileSync(join(planDir, 'plan.html'), renderPlanPage(project, site, pd, navLinks('plan')));
  if (pd.hasBatches) writeFileSync(join(planDir, 'batches.html'), renderBatchesPage(project, site, pd, navLinks('batches')));
}

// ---- Overview (per-plan hub) ----
function renderOverview(project, site, pd, nav) {
  const { id, meta, plan, progress, hasBatches, hasMeta } = pd;
  const total = (meta && meta.cycles.length) || plan.cycles.length;
  const done = progress.counts.ok || 0;
  const nBatches = (meta && meta.batches && meta.batches.length) || (pd.batches ? pd.batches.batches.length : 0);

  const heroMeta = [
    `<b>${total}</b> TDD cycles`,
    nBatches ? `<b>${nBatches}</b> parallel batches` : null,
    meta && meta.wallTimeSaved ? `<b>${esc(meta.wallTimeSaved)}</b> wall-time saved` : null,
    `<b>${done} / ${total}</b> shipped`,
  ].filter(Boolean);

  const heroHtml = T.hero({
    eyebrow: `Build plan ${id}`,
    title: esc(overviewTitle(site, meta, plan)),
    lede: T.inlineProse((meta && meta.oneLiner) || ''),
    metaItems: heroMeta,
  });

  // D4: extra overview prose — only present on YAML-sourced plans. `plan.overviewExtras` is
  // now an ordered list of { id, heading, body }. Rendered as sections after Context.
  const extraSections = (plan.overviewExtras || []).map((s) => ({ id: s.id, label: s.heading, h: s.heading, body: s.body }));

  // TOC + diagram sections are conditional on available graph data.
  const hasGraph = hasMeta && Array.isArray(meta.cycles) && meta.cycles.length > 0;
  const hasTimeline = hasGraph && Array.isArray(meta.batches) && meta.batches.length > 0;
  const toc = [{ id: 'context', label: 'Context' }];
  for (const s of extraSections) toc.push({ id: s.id, label: s.label });
  if (hasGraph) toc.push({ id: 'dag', label: 'Cycle dependencies' });
  if (hasTimeline) toc.push({ id: 'timeline', label: 'Batch timeline' });
  toc.push({ id: 'progress', label: 'Progress' });
  toc.push({ id: 'read-next', label: 'Read next' });
  toc.push({ id: 'conventions', label: 'Conventions' });

  let content = `
    <section id="context" class="section">
      <h2>Context</h2>
      ${T.prose(plan.context)}
    </section>

    <hr class="section-rule">
${extraSections.map((s) => `
    <section id="${s.id}" class="section">
      <h2>${esc(s.h)}</h2>
      ${T.prose(s.body)}
    </section>

    <hr class="section-rule">
`).join('')}`;

  if (hasGraph) {
    content += `
    <section id="dag" class="section">
      <h2>Cycle dependencies</h2>
      <p>Each node is a cycle; an arrow means &ldquo;must ship first&rdquo;. The critical path is highlighted.</p>
      <div class="figure">
        ${T.renderDag(meta)}
        <div class="legend">
          <span><i class="sw crit"></i> critical path</span>
          <span><i class="sw norm"></i> parallel-safe</span>
          <span><i class="ln crit"></i> blocks (critical)</span>
          <span><i class="ln"></i> blocks</span>
        </div>
        ${(meta.criticalPath || []).length ? `<p class="cap">Critical path: <b>${esc((meta.criticalPath || []).join(' → '))}</b>.</p>` : ''}
      </div>
    </section>

    <hr class="section-rule">
`;
  }

  if (hasTimeline) {
    content += `
    <section id="timeline" class="section">
      <h2>Batch timeline &amp; critical path</h2>
      <p>Cycles within a batch are file-disjoint and run in parallel sessions. The critical path determines wall-time.</p>
      <div class="figure">
        ${T.renderTimeline(meta)}
        <p class="cap">Critical path = <b>${meta.batches.length} batches</b> vs <b>${total} cycles</b> serial.${meta.wallTimeSaved ? ` <b>${esc(meta.wallTimeSaved)}</b> wall-time saved.` : ''}</p>
      </div>
      <div class="stats">
        <div class="stat"><div class="v">${meta.batches.length}</div><div class="k">Batches</div></div>
        <div class="stat"><div class="v">${total}</div><div class="k">Cycles</div></div>
        ${meta.wallTimeSaved ? `<div class="stat"><div class="v"><span class="accent">${esc(meta.wallTimeSaved)}</span></div><div class="k">Wall-time saved</div></div>` : ''}
        <div class="stat"><div class="v">${(meta.criticalPath || []).length}</div><div class="k">Critical-path hops</div></div>
      </div>
    </section>

    <hr class="section-rule">
`;
  }

  content += `
    <section id="progress" class="section">
      <h2>Progress</h2>
      <p>Live status parsed from <code>${esc(srcProgress(pd))}</code>.</p>
      ${T.progressDashboard(meta, plan, progress)}
    </section>

    <hr class="section-rule">

    <section id="read-next" class="section">
      <h2>Read next</h2>
      <div class="card-grid">
        <a class="linkcard" href="plan.html">
          <span class="num">01 · THE PLAN</span>
          <h3>The ${total} cycles</h3>
          <p>Every cycle in expandable detail: scope, the RED / GREEN / REVIEW / REFACTOR phases, and the verbatim code blocks. Plus the TDD loop diagram.</p>
          <span class="go">View cycles</span>
        </a>
${hasBatches ? `        <a class="linkcard" href="batches.html">
          <span class="num">02 · THE RUNBOOK</span>
          <h3>Parallel batch orchestration</h3>
          <p>How to run this plan across parallel sessions: worktree setup, merge protocol, the file-ownership matrix, and the copy-paste session prompts.</p>
          <span class="go">Open runbook</span>
        </a>` : ''}
      </div>
    </section>

    <hr class="section-rule">

    <section id="conventions" class="section">
      <h2>Conventions in play</h2>
      <p>Every cycle runs through the same disciplined loop, defined in the shared rules under <code>.agents/rules/</code>.</p>
      <div class="conv-grid">
        <div class="conv"><h4>${T.ICONS.gate} Architect gate</h4><p>Each cycle carries an architecture-review tier (<code>top</code>, <code>mid</code>, <code>none</code>, or <code>deferred</code>). Legacy provider aliases are normalized while loading. A fresh <code>software-architect</code> returns a <code>GO</code> / <code>NO-GO</code> verdict <strong>before RED</strong> for the non-trivial ones.</p></div>
        <div class="conv"><h4>${T.ICONS.eye} Reviewer separation</h4><p>REVIEW is performed by a fresh <code>code-reviewer</code> sub-agent &mdash; never self-review. Security-tier cycles add a <code>security-reviewer</code> second pass.</p></div>
        <div class="conv"><h4>${T.ICONS.x} NO-DEFER</h4><p>Every <code>[BLOCKER]</code> and <code>[REFACTOR]</code> finding is resolved in the same cycle&rsquo;s REFACTOR pass. Scope discipline is not a reason to defer an in-scope finding.</p></div>
      </div>
    </section>
`;

  const footerSrc = srcAll(pd);
  return T.pageShell({
    site,
    title: `${site.productName} · plan-${id} — Overview`,
    description: (meta && meta.oneLiner) || `Build documentation for ${site.productName} plan-${id}.`,
    assetPrefix: '../',
    nav,
    hero: heroHtml,
    toc,
    content,
    footerSource: footerSrc,
  });
}

// ---- Plan page (cycle cards) ----
function renderPlanPage(project, site, pd, nav) {
  const { id, meta, plan } = pd;
  const heroHtml = T.hero({
    eyebrow: `The plan · ${plan.cycles.length} TDD cycles`,
    title: 'The cycles',
    lede: `Each cycle runs the <strong>RED &rarr; GREEN &rarr; REVIEW &rarr; (REFACTOR &rarr; REVIEW)* &rarr; COMMIT</strong> loop. Code blocks are reproduced verbatim from <code>${esc(srcPlan(pd))}</code>.`,
  });

  const toc = [{ id: 'tdd-loop', label: 'The TDD loop' }]
    .concat(plan.cycles.map((c) => ({ id: T.anchorId(c.id), label: `${c.id} — ${shortLabel(c.title)}` })))
    .concat([
      { id: 'open-q', label: 'Open questions' },
      { id: 'followups', label: 'Cycle follow-ups' },
    ]);

  const cards = plan.cycles.map((c, i) => T.cycleCard(c, { open: i === 0 })).join('\n\n');

  const content = `
    <section id="tdd-loop" class="section">
      <h2>The TDD loop</h2>
      <p>REVIEW is the gate. <strong>APPROVED</strong> goes straight to COMMIT; <strong>NEEDS FIX</strong> runs REFACTOR and loops back to REVIEW until approved.</p>
      <div class="figure">
        ${T.renderTddLoop()}
        <p class="cap"><b>RED</b> &rarr; <b>GREEN</b> &rarr; <b>REVIEW</b> &rarr; (<b>REFACTOR</b> &rarr; REVIEW)* &rarr; <b>COMMIT</b></p>
      </div>
      <div style="display:flex;justify-content:flex-end;margin:8px 0 0">
        <button class="copy-btn" type="button" data-expand-all>Expand all</button>
      </div>
    </section>

    <hr class="section-rule">

${cards}

    <hr class="section-rule">

    <section id="open-q" class="section">
      <h2>Open questions</h2>
      ${T.tableBlock(plan.openQuestions, { placeholder: 'Empty placeholder — filled as cycles expand and surface open decisions.' })}
    </section>

    <hr class="section-rule">

    <section id="followups" class="section">
      <h2>Cycle follow-ups</h2>
      <p style="font-size:.92rem;color:var(--ink-3)">NITs logged, won&rsquo;t-fix, or deferred-structural; populated post-REVIEW per cycle.</p>
      ${T.tableBlock(plan.followups, { placeholder: 'Empty placeholder — populated post-REVIEW per cycle.' })}
    </section>
`;

  return T.pageShell({
    site,
    title: `${site.productName} · plan-${id} — The cycles`,
    description: `The ${plan.cycles.length} TDD cycles of ${site.productName} plan-${id}.`,
    assetPrefix: '../',
    nav,
    hero: heroHtml,
    toc,
    content,
    footerSource: srcPlan(pd),
  });
}

// ---- Batches page (runbook) ----
function renderBatchesPage(project, site, pd, nav) {
  const { id, meta, batches } = pd;
  const hasMatrix = meta && Array.isArray(meta.fileOwnership) && meta.fileOwnership.length > 0;

  const heroHtml = T.hero({
    eyebrow: `The runbook · ${batches.batches.length} batches`,
    title: T.inlineProse(batches.h1.replace(/^Parallel Batch Orchestration\s*[—-]\s*/i, 'Parallel batch orchestration: ').replace(/^Parallel batch orchestration:\s*/, '')) || 'Parallel batch orchestration',
    lede: `The canonical source for running plan-${id} cycles across parallel sessions. One prompt block per fresh <code>/clear</code> session, each in its own git worktree.`,
  });

  const proseSections = batches.sections.filter((s) => !isOwnershipSection(s) && !isBatchSummary(s));
  const toc = [];
  for (const s of proseSections) toc.push({ id: slug(s.heading), label: s.heading });
  if (batches.sections.some(isBatchSummary)) toc.push({ id: 'batch-summary', label: 'Batch summary' });
  if (batches.sections.some(isOwnershipSection)) toc.push({ id: 'ownership', label: 'File-ownership map' });
  for (const b of batches.batches) toc.push({ id: slug(b.id), label: b.heading, sub: false });

  let body = '';
  if (batches.intro) body += `<section class="section">${T.prose(batches.intro)}</section>\n<hr class="section-rule">\n`;

  for (const s of batches.sections) {
    if (isOwnershipSection(s)) {
      body += `<section id="ownership" class="section">
        <h2>File-ownership map</h2>
        <p>Within a batch the cycles are file-disjoint &mdash; that is what makes them conflict-free to run in parallel and to fast-forward merge.</p>
        ${hasMatrix ? T.ownershipMatrix(meta) : ''}
        ${hasMatrix ? `<div class="conv" style="margin-top:18px"><h4>${T.ICONS.check} Conflict notes from source</h4></div>` : ''}
        ${T.prose(hasMatrix ? stripLeadingTable(s.body) : s.body)}
      </section>\n<hr class="section-rule">\n`;
    } else if (isBatchSummary(s)) {
      body += `<section id="batch-summary" class="section">
        <h2>Batch summary</h2>
        ${T.prose(s.body)}
      </section>\n<hr class="section-rule">\n`;
    } else {
      body += `<section id="${slug(s.heading)}" class="section">
        <h2>${esc(s.heading)}</h2>
        ${T.prose(s.body)}
      </section>\n<hr class="section-rule">\n`;
    }
  }

  for (const b of batches.batches) {
    const sessions = b.sessions
      .map((sess) => T.promptPanel({ ...sess, securityTier: /security tier/i.test(sess.prompt + sess.before + sess.title) }))
      .join('\n');
    body += `<section id="${slug(b.id)}" class="section">
      <h2>${esc(b.heading)}</h2>
      ${b.intro ? `<div style="font-size:.92rem;color:var(--ink-3)">${T.prose(b.intro)}</div>` : ''}
${sessions}
    </section>\n<hr class="section-rule">\n`;
  }

  body = body.replace(/\n<hr class="section-rule">\n$/, '\n');

  return T.pageShell({
    site,
    title: `${site.productName} · plan-${id} — Parallel runbook`,
    description: `The parallel batch orchestration runbook for ${site.productName} plan-${id}.`,
    assetPrefix: '../',
    nav,
    hero: heroHtml,
    toc,
    content: body,
    footerSource: srcBatches(pd),
  });
}

// ============================================================
// Per-project landing — lists this project's plans
// ============================================================
function renderLanding(project, site, planData) {
  const nav = {
    home: 'index.html',
    tag: 'docs',
    links: [{ label: 'All plans', href: 'index.html', current: true }].concat(
      planData.map((pd) => ({ label: `plan-${pd.id}`, href: `${pd.id}/index.html` }))
    ),
  };

  const heroHtml = T.hero({
    eyebrow: site.landing.eyebrow,
    title: site.landing.title,
    lede: site.landing.lede,
    metaItems: [
      `<b>${planData.length}</b> plan${planData.length === 1 ? '' : 's'}`,
      `<b>${planData.reduce((n, pd) => n + planCycleCount(pd), 0)}</b> total cycles`,
      `<b>${planData.reduce((n, pd) => n + (pd.progress.counts.ok || 0), 0)}</b> shipped`,
    ],
  });

  const cards = planData
    .map((pd) => {
      const total = planCycleCount(pd);
      const done = pd.progress.counts.ok || 0;
      const pct = total ? Math.round((done / total) * 100) : 0;
      const nBatches = (pd.meta && pd.meta.batches && pd.meta.batches.length) || (pd.batches ? pd.batches.batches.length : 0);
      return `        <a class="linkcard" href="${pd.id}/index.html">
          <span class="num">PLAN-${pd.id}</span>
          <h3>${esc(overviewTitle(site, pd.meta, pd.plan))}</h3>
          <p>${esc((pd.meta && pd.meta.oneLiner) || '')}</p>
          <div class="plan-progress" aria-hidden="true"><div class="bar"><span style="width:${pct}%"></span></div></div>
          <span class="go">${done} / ${total} shipped${nBatches ? ` · ${nBatches} batches` : ''}</span>
        </a>`;
    })
    .join('\n');

  const rows = planData
    .map((pd) => {
      const total = planCycleCount(pd);
      const done = pd.progress.counts.ok || 0;
      const status = done === 0 ? 'idle' : done === total ? 'ok' : 'wip';
      const label = done === 0 ? 'Not started' : done === total ? 'Shipped' : `${done}/${total} in progress`;
      const nBatches = (pd.meta && pd.meta.batches && pd.meta.batches.length) || (pd.batches ? pd.batches.batches.length : 0);
      return `            <tr><td class="mono">plan-${pd.id}</td><td>${esc(shortLabel(overviewTitle(site, pd.meta, pd.plan)))}</td><td>${total}</td><td>${nBatches || '—'}</td><td>${T.statusPill(status, label)}</td><td><a href="${pd.id}/index.html">Open →</a></td></tr>`;
    })
    .join('\n');

  const content = `
    <section class="section">
      <h2>Plans</h2>
      <div class="card-grid">
${cards}
      </div>
    </section>

    <hr class="section-rule">

    <section class="section">
      <h2>At a glance</h2>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Plan</th><th>Theme</th><th>Cycles</th><th>Batches</th><th>Status</th><th></th></tr></thead>
          <tbody>
${rows}
          </tbody>
        </table>
      </div>
    </section>

    <hr class="section-rule">

    <section class="section">
      <h2>How these docs are built</h2>
      <p>This site is generated by a shared, config-driven Node tool at <code>tools/docs-gen/</code>. Each plan is a single source-of-truth YAML file (<code>plan-NNN.yaml</code>) holding cycles, prompts, diagram graph, and live status in one place, validated against <code>schema/plan.schema.json</code> on every build. Re-run <code>npm run build</code> to regenerate.</p>
    </section>
`;

  return T.pageShell({
    site,
    title: `${site.productName} · build documentation`,
    description: site.landing.lede,
    assetPrefix: '',
    nav,
    hero: heroHtml,
    toc: null,
    content,
    footerSource: planData.map((pd) => `plan-${pd.id}`).join(' · '),
  });
}

// ============================================================
// orchestration
// ============================================================
function build(targetProject = null, targetPlan = null, opts = {}) {
  const projects = loadRegistry();
  const selected = targetProject ? projects.filter((p) => p.name === targetProject) : projects;
  if (selected.length === 0) {
    console.error(`Unknown project "${targetProject}". Available: ${projects.map((p) => p.name).join(', ')}`);
    process.exit(1);
  }
  for (const project of selected) {
    if (targetPlan && !project.plans.some((pl) => pl.id === targetPlan)) {
      if (targetProject) {
        console.error(`Unknown plan "${targetPlan}" in project "${project.name}". Available: ${project.plans.map((pl) => pl.id).join(', ')}`);
        process.exit(1);
      }
      continue;
    }
    try {
      buildProject(project, targetPlan, opts);
    } catch (e) {
      // A YAML schema / referential-integrity failure aborts the build loudly + non-zero.
      console.error(`\n${e.message}\n`);
      process.exit(1);
    }
  }
}

// ---- watch ----
async function watch(targetProject, targetPlan) {
  const { default: chokidar } = await import('chokidar');
  const projects = loadRegistry();
  build(targetProject, targetPlan);

  // Watch every configured docsRoot (depth 0) for *.yaml source changes.
  const roots = projects.map((p) => join(REPO_ROOT, p.docsRoot));
  console.log(`\n  watching ${roots.length} docsRoot(s) for *.yaml …  (Ctrl-C to stop)\n`);
  const watcher = chokidar.watch(roots, {
    ignoreInitial: true,
    depth: 0,
    ignored: (p, stats) => stats?.isFile() && !/\.yaml$/.test(p),
  });
  const rebuild = (changedPath) => {
    const hit = affectedBy(projects, changedPath);
    if (!hit) return;
    try {
      console.log(`  • ${hit.file} changed → rebuilding ${hit.project}${hit.plan ? '/' + hit.plan : ''}`);
      build(hit.project, hit.plan);
    } catch (e) {
      console.error('  ✗ rebuild failed:', e.message);
    }
  };
  watcher.on('change', rebuild).on('add', rebuild);
}

// Map a changed file path → { project, plan?, file } (only the affected project rebuilds).
function affectedBy(projects, changedPath) {
  const parts = changedPath.split('/');
  const file = parts[parts.length - 1];
  for (const project of projects) {
    const rootAbs = join(REPO_ROOT, project.docsRoot);
    if (!changedPath.startsWith(rootAbs + '/')) continue;
    // which plan inside this project? (match the plan's YAML source filename)
    for (const pl of project.plans) {
      const yamlName = pl.yaml || `plan-${pl.id}.yaml`;
      if (file === yamlName) return { project: project.name, plan: pl.id, file };
    }
    // a YAML in the project not mapped to a specific plan → rebuild whole project
    return { project: project.name, plan: null, file };
  }
  return null;
}

// ============================================================
// helpers
// ============================================================
function planCycleCount(pd) {
  return (pd.meta && pd.meta.cycles && pd.meta.cycles.length) || pd.plan.cycles.length;
}

// Source filename for footer/description labels — the single YAML file.
function srcPlan(pd) { return pd.cfg.sourceName; }
function srcProgress(pd) { return pd.cfg.sourceName; }
function srcBatches(pd) { return pd.cfg.sourceName; }
function srcAll(pd) { return pd.cfg.sourceName; }

// Overview / card / landing title: productName + meta.title (preferred) or the plan H1.
function overviewTitle(site, meta, plan) {
  if (meta && meta.title) return meta.title;
  return plan.h1;
}

function shortLabel(t) {
  let s = (t || '').replace(/`/g, '').replace(/\(.*?\)/g, '').trim();
  if (s.length > 30) s = s.slice(0, 29).trimEnd() + '…';
  return s;
}
function isOwnershipSection(s) {
  return /file ownership/i.test(s.heading || '');
}
function isBatchSummary(s) {
  return /batch summary/i.test(s.heading || '');
}
function stripLeadingTable(body) {
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim().startsWith('|')) i++;
  while (i < lines.length && lines[i].trim().startsWith('|')) i++;
  return lines.slice(i).join('\n').trim();
}
function slug(s) {
  return (s || '').toLowerCase().replace(/[^\w.]+/g, '-').replace(/(^-|-$)/g, '');
}
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================
// main
// ============================================================
function main() {
  const args = process.argv.slice(2);
  const isWatch = args.includes('--watch');
  const isValidate = args.includes('--validate'); // validate YAML sources without building
  const outArg = args.find((a) => a.startsWith('--out='));
  const positional = args.filter((a) => !a.startsWith('--'));
  const targetProject = positional[0] && positional[0] !== 'all' ? positional[0] : null;
  const targetPlan = positional[1] || null;
  const opts = { outDir: outArg ? outArg.slice('--out='.length) : null };

  const label = targetProject ? `${targetProject}${targetPlan ? '/' + targetPlan : ''}` : 'all projects';

  if (isValidate) {
    validateAll(targetProject, targetPlan);
    return;
  }

  console.log(`docs-gen — building: ${label}${opts.outDir ? ' → ' + opts.outDir : ''}`);
  if (isWatch) {
    watch(targetProject, targetPlan);
  } else {
    build(targetProject, targetPlan, opts);
    console.log('\nDone.');
  }
}

// Validate every YAML-sourced plan (schema + referential integrity), no rendering.
function validateAll(targetProject, targetPlan) {
  const projects = loadRegistry().filter((p) => !targetProject || p.name === targetProject);
  let checked = 0, failed = 0;
  for (const project of projects) {
    for (const pl of project.plans) {
      if (targetPlan && pl.id !== targetPlan) continue;
      const yamlName = pl.yaml || `plan-${pl.id}.yaml`;
      if (!sourceExists(project.docsRoot, yamlName)) continue; // MD-sourced plan; nothing to validate here
      checked++;
      try {
        validateDoc(parseYamlDoc(join(REPO_ROOT, project.docsRoot, yamlName)), `${project.name}/${yamlName}`);
        console.log(`  ✓ ${project.name}/${yamlName} valid`);
      } catch (e) {
        failed++;
        console.error(`\n${e.message}\n`);
      }
    }
  }
  if (checked === 0) console.log('  (no YAML-sourced plans found)');
  if (failed > 0) { console.error(`validate: ${failed} file(s) FAILED.`); process.exit(1); }
  console.log(`\nvalidate: ${checked} YAML source(s) OK.`);
}

main();
